// CI: the stored document format of Content Intelligence (ADR-058 §5).
//
// The app stores every template version as an `openpencil-scene-graph` JSON
// envelope over the engine's portable scene-graph data — NOT as `.fig` bytes
// and not as `.pen` (import-only in 0.15.1). This file is the fork-side twin
// of `src/design/engine/openpencil/document.ts` in the app: same envelope,
// same field rules, so a document round-trips between the Studio, the app's
// headless renderer and the database without conversion.

import type { SceneNode, Variable, VariableCollection } from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

export const DOCUMENT_FORMAT = 'openpencil-scene-graph' as const

export interface SerializedGraph {
  rootId: string
  /** `[id, node]` pairs; node shape is the engine's `SceneNode` minus derived caches. */
  nodes: Array<[string, Record<string, unknown>]>
  /** `[hash, base64 bytes]`. */
  images: Array<[string, string]>
  variables: Array<[string, Variable]>
  variableCollections: Array<[string, VariableCollection]>
  activeMode: Array<[string, string]>
  documentColorSpace: string
}

export interface SerializedDocument {
  documentFormat: typeof DOCUMENT_FORMAT
  schemaVersion: 1
  engineVersion: string
  graph: SerializedGraph
}

/** Node fields the engine derives at render time; never stored, never diffed. */
const DERIVED_NODE_FIELDS: ReadonlySet<string> = new Set(['textPicture', 'derivedTextGlyphs'])

export function isSerializedDocument(value: unknown): value is SerializedDocument {
  if (!value || typeof value !== 'object') return false
  const doc = value as Partial<SerializedDocument>
  if (doc.documentFormat !== DOCUMENT_FORMAT || doc.schemaVersion !== 1) return false
  if (typeof doc.engineVersion !== 'string') return false
  const graph = doc.graph as Partial<SerializedGraph> | undefined
  return Boolean(
    graph &&
    typeof graph.rootId === 'string' &&
    Array.isArray(graph.nodes) &&
    Array.isArray(graph.images) &&
    Array.isArray(graph.variables) &&
    Array.isArray(graph.variableCollections) &&
    Array.isArray(graph.activeMode)
  )
}

export function serializeGraph(graph: SceneGraph, engineVersion: string): SerializedDocument {
  const nodes: Array<[string, Record<string, unknown>]> = []
  for (const [id, node] of graph.nodes) {
    const plain: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node)) {
      if (DERIVED_NODE_FIELDS.has(key) || value === undefined) continue
      plain[key] = value
    }
    nodes.push([id, plain])
  }
  return {
    documentFormat: DOCUMENT_FORMAT,
    schemaVersion: 1,
    engineVersion,
    graph: {
      rootId: graph.rootId,
      nodes,
      images: [...graph.images].map(([hash, bytes]) => [hash, bytesToBase64(bytes)]),
      variables: [...graph.variables],
      variableCollections: [...graph.variableCollections],
      activeMode: [...graph.activeMode],
      documentColorSpace: graph.documentColorSpace
    }
  }
}

export function deserializeGraph(document: unknown): SceneGraph {
  if (!isSerializedDocument(document)) {
    const format =
      document && typeof document === 'object' && 'documentFormat' in document
        ? String(document.documentFormat)
        : typeof document
    throw new Error(`Unsupported document format ${format}`)
  }
  const graph = new SceneGraph()
  graph.rootId = document.graph.rootId
  graph.nodes = new Map(
    document.graph.nodes.map(([id, plain]) => {
      const stored = plain as Partial<SceneNode> & { type: SceneNode['type'] }
      // Stored nodes may be partial (older engine, the app's fake engine): every
      // missing field takes the engine's own default for that node type.
      const node: SceneNode = { ...createDefaultNode(() => id, stored.type), ...stored, id }
      node.childIds = [...node.childIds]
      node.guides = Array.isArray(node.guides) ? node.guides : []
      node.pluginData = Array.isArray(node.pluginData) ? node.pluginData : []
      node.textPicture = null
      node.derivedTextGlyphs = null
      return [id, node]
    })
  )
  graph.images = new Map(document.graph.images.map(([hash, b64]) => [hash, base64ToBytes(b64)]))
  graph.variables = new Map(document.graph.variables)
  graph.variableCollections = new Map(document.graph.variableCollections)
  graph.activeMode = new Map(document.graph.activeMode)
  graph.documentColorSpace = document.graph.documentColorSpace as SceneGraph['documentColorSpace']
  graph.instanceIndex = new Map()
  for (const node of graph.nodes.values()) {
    if (node.type === 'INSTANCE' && node.componentId) {
      const set = graph.instanceIndex.get(node.componentId) ?? new Set<string>()
      set.add(node.id)
      graph.instanceIndex.set(node.componentId, set)
    }
  }
  return graph
}

// ---------------------------------------------------------------------------
// Brand variables (mirror of the app's `brand-variables.ts`; read-only here)
// ---------------------------------------------------------------------------

export const BRAND_MODE_ID = 'brand-default'
const BRAND_VARIABLE_PREFIX = 'brand:'

function brandStringValue(graph: SceneGraph, key: string): string | null {
  const value = graph.variables.get(`${BRAND_VARIABLE_PREFIX}${key}`)?.valuesByMode[BRAND_MODE_ID]
  return typeof value === 'string' ? value : null
}

/**
 * STRING bindings the engine does not resolve itself: a text node whose
 * `fontFamily` / `text` is bound to `brand:fontArabic` / `brand:fontLatin` /
 * `brand:watermark` takes the variable's current value when the document
 * opens. Returns the ids touched; `update` routes through the editor so the
 * layout is invalidated.
 */
export function resolveBrandStrings(
  graph: SceneGraph,
  update: (id: string, changes: Partial<SceneNode>) => void
): string[] {
  const touched: string[] = []
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'TEXT') continue
    const changes: Partial<SceneNode> = {}
    const fontBinding = node.boundVariables.fontFamily
    if (fontBinding === 'brand:fontArabic' || fontBinding === 'brand:fontLatin') {
      const family = brandStringValue(graph, fontBinding.slice(BRAND_VARIABLE_PREFIX.length))
      if (family && family !== node.fontFamily) changes.fontFamily = family
    }
    if (node.boundVariables.text === 'brand:watermark') {
      const text = brandStringValue(graph, 'watermark')
      if (text !== null && text !== node.text) changes.text = text
    }
    if (Object.keys(changes).length > 0) {
      update(node.id, changes)
      touched.push(node.id)
    }
  }
  return touched
}

// ---------------------------------------------------------------------------
// Base64 (browser + Bun; no Buffer dependency)
// ---------------------------------------------------------------------------

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
