// CI: the stored document format of Content Intelligence (ADR-058 §5).
//
// The app stores every template version as an `openpencil-scene-graph` JSON
// envelope over the engine's portable scene-graph data — NOT as `.fig` bytes
// and not as `.pen` (import-only in 0.15.1). This file is the fork-side twin
// of `src/design/engine/openpencil/document.ts` in the app: same envelope,
// same field rules, so a document round-trips between the Studio, the app's
// headless renderer and the database without conversion.

import { colorToCSS } from '@open-pencil/core/color'
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
//
// CI: Track E3d-a (FB-44 §4) — the kit is TWO colours. The document carries a
// `Brand` collection with `brand:primary` / `brand:secondary` COLOR variables
// (the app writes them with `applyBrandVariables` before handing the document
// over); fonts and the watermark are the template's own. The colour picker
// offers the two as a **Brand** swatch row (`VariableBindingPicker.vue`).

export const BRAND_COLLECTION_ID = 'brand'
export const BRAND_MODE_ID = 'brand-default'
export const BRAND_COLOR_KEYS = ['primary', 'secondary'] as const
export type BrandColorKey = (typeof BRAND_COLOR_KEYS)[number]

export function brandVariableId(key: BrandColorKey): string {
  return `brand:${key}`
}

export interface BrandSwatch {
  key: BrandColorKey
  variableId: string
  /** `$brand/primary` — the variable's display name. */
  name: string
  /** CSS colour for the swatch, from the variable's value. */
  css: string
}

/** The two brand swatches present in a variable list, in kit order; a missing one is skipped. */
export function brandSwatches(variables: readonly Variable[]): BrandSwatch[] {
  const out: BrandSwatch[] = []
  for (const key of BRAND_COLOR_KEYS) {
    const variable = variables.find((v) => v.id === brandVariableId(key))
    if (variable?.type !== 'COLOR') continue
    const value = variable.valuesByMode[BRAND_MODE_ID] ?? Object.values(variable.valuesByMode)[0]
    if (typeof value !== 'object' || !('r' in value)) continue
    out.push({ key, variableId: variable.id, name: variable.name, css: colorToCSS(value) })
  }
  return out
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
