// CI: a brand asset is a plain, editable shape (FB-58, ADR-058 §8 "As built —
// fix FB-58").
//
// The Assets panel's Brand library still PRESENTS every asset as a COMPONENT
// (thumbnail + "Hero · user image (default)" — `brand-library.ts`), but what
// lands in the document is never an INSTANCE: OpenPencil locks instance
// children, so the image rectangle inside could not be resized (the frame only
// clipped), rounded, cropped or turned into a circle. The component wrapper
// bought nothing — the binding is the LAYER NAME (`brand:user-image:<asset>`)
// and both the renderer and the bindings report resolve by name.
//
// Three doors, one shape:
//   • insertion (`insertBrandShape`) — the drop / click-insert / catalog paths
//     all reach `createInstanceFromComponent`; the hosted seam
//     (`insert-override.ts`) branches here for a brand-library component and
//     creates ONE `RECTANGLE` carrying the child's IMAGE fill, the component's
//     name, size and the three brand pluginData keys. One undo entry.
//   • load (`detachBrandInstances`) — every INSTANCE of a brand component in a
//     saved template becomes the same shape on the deserialised graph, before
//     the store sees it: no dirty flag, no history; the next save writes the
//     plain node. Idempotent — a shape is not an instance.
//   • Shape (`setBrandShape`) — Rectangle ⇄ Circle is a `type` swap on the same
//     node id (the engine changes a node's type in place: `detachInstance`
//     does INSTANCE → FRAME the same way), so name, fill, size, position,
//     pluginData, opacity and effects all survive and the selection stays.

import type { Vector } from '@open-pencil/scene-graph/primitives'
import type { Fill, SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { createInstanceOverrideState } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

import { bindingOf, DEFAULT_VOCABULARY, isContentTextSlot, PLUGIN_ID, pluginValue } from './bindings'
import type { StudioBindingsVocabulary } from './api'

/** The pluginData keys a brand shape carries (written by `buildBrandLibraryGraph`). */
export const BRAND_ASSET_PLUGIN_KEYS = ['brandAsset', 'brandAssetKind', 'role'] as const

/** The two shapes the Bindings panel offers for a bound image layer. */
export type BrandShapeType = 'RECTANGLE' | 'ELLIPSE'
export const BRAND_SHAPE_TYPES: readonly BrandShapeType[] = ['RECTANGLE', 'ELLIPSE']

export const SHAPE_COPY = {
  /** Accessible name of the segmented control. */
  label: 'Shape',
  rectangle: 'Rectangle',
  circle: 'Circle',
  /** Undo label. */
  undo: 'Shape',
  insertUndo: 'Insert brand asset'
} as const

export function isBrandShapeType(type: unknown): type is BrandShapeType {
  return (BRAND_SHAPE_TYPES as readonly unknown[]).includes(type)
}

type PluginEntry = { pluginId: string; key: string; value: string }

function pluginEntries(node: Pick<SceneNode, 'pluginData'>): PluginEntry[] {
  return Array.isArray(node.pluginData) ? (node.pluginData as PluginEntry[]) : []
}

function firstImageFill(fills: readonly Fill[] | undefined): Fill | null {
  return fills?.find((f) => f.type === 'IMAGE' && f.imageHash) ?? null
}

/**
 * The IMAGE fill a brand component / instance shows: the first descendant in
 * paint order carrying one. Copied, so the source node is never shared.
 */
export function brandImageFill(graph: SceneGraph, nodeId: string): Fill | null {
  const own = firstImageFill(graph.getNode(nodeId)?.fills)
  if (own) return { ...own }
  for (const child of graph.getChildren(nodeId)) {
    const fill = brandImageFill(graph, child.id)
    if (fill) return fill
  }
  return null
}

/**
 * True for a COMPONENT the brand library published (pluginData `brandAsset`),
 * or a legacy one named `brand:*` whose only content is an image child — a
 * template saved before the pluginData keys existed.
 */
export function isBrandLibraryComponent(
  graph: SceneGraph,
  node: SceneNode | undefined | null,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): node is SceneNode {
  if (node?.type !== 'COMPONENT') return false
  if (pluginValue(node, 'brandAsset') !== null) return true
  const binding = bindingOf(node, vocabulary)
  if (binding?.kind !== 'brand') return false
  const children = graph.getChildren(node.id)
  return children.length === 1 && firstImageFill(children[0].fills) !== null
}

/** The brand pluginData the shape must carry: the node's own, else the component's. */
function brandPluginData(
  node: Pick<SceneNode, 'pluginData'>,
  component: Pick<SceneNode, 'pluginData'> | null
): PluginEntry[] {
  const own = pluginEntries(node)
  const fromComponent = component ? pluginEntries(component) : []
  const out = [...own]
  for (const key of BRAND_ASSET_PLUGIN_KEYS) {
    if (own.some((e) => e.pluginId === PLUGIN_ID && e.key === key)) continue
    const entry = fromComponent.find((e) => e.pluginId === PLUGIN_ID && e.key === key)
    if (entry) out.push({ ...entry })
  }
  return out
}

export interface BrandShapeFacts {
  name: string
  width: number
  height: number
  fills: Fill[]
  pluginData: PluginEntry[]
}

/** What a brand component becomes when inserted: name · size · the image fill · pluginData. */
export function brandShapeFacts(graph: SceneGraph, component: SceneNode): BrandShapeFacts | null {
  const fill = brandImageFill(graph, component.id)
  if (!fill) return null
  return {
    name: component.name,
    width: component.width,
    height: component.height,
    fills: [fill],
    pluginData: brandPluginData(component, null)
  }
}

function viewportInsertionPoint(
  store: EditorStore,
  parentId: string,
  size: { width: number; height: number }
): Vector {
  const centre = store.viewportCanvasCenter()
  const canvas = store.screenToCanvas(centre.x, centre.y)
  const parentOffset =
    parentId === store.state.currentPageId ? { x: 0, y: 0 } : store.graph.getAbsolutePosition(parentId)
  return {
    x: canvas.x - parentOffset.x - size.width / 2,
    y: canvas.y - parentOffset.y - size.height / 2
  }
}

/**
 * Insert a brand-library component as a plain `RECTANGLE` — the hosted answer to
 * `createInstanceFromComponent`. Returns the new node id, `null` when the
 * component holds no image, and `undefined` when `componentId` is not a brand
 * component at all (the caller falls through to the upstream instance path).
 */
export function insertBrandShape(
  store: EditorStore,
  componentId: string,
  x?: number,
  y?: number,
  parentId: string = store.state.currentPageId,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): string | null | undefined {
  const component = store.graph.getNode(componentId)
  if (!isBrandLibraryComponent(store.graph, component, vocabulary)) return undefined
  const facts = brandShapeFacts(store.graph, component)
  if (!facts) return null
  const at =
    x === undefined || y === undefined ? viewportInsertionPoint(store, parentId, facts) : { x, y }
  const previousSelection = new Set(store.state.selectedIds)
  const node = store.graph.createNode('RECTANGLE', parentId, {
    name: facts.name,
    x: at.x,
    y: at.y,
    width: facts.width,
    height: facts.height,
    fills: facts.fills,
    strokes: [],
    pluginData: facts.pluginData as SceneNode['pluginData']
  })
  const id = node.id
  const snapshot = { ...node }
  store.select([id])
  store.pushUndoEntry({
    label: SHAPE_COPY.insertUndo,
    forward: () => {
      store.graph.createNode(snapshot.type, parentId, snapshot)
      store.select([id])
    },
    inverse: () => {
      store.graph.deleteNode(id)
      store.select([...previousSelection])
    }
  })
  store.requestRender()
  return id
}

export interface DetachBrandInstancesReport {
  detached: number
  nodeIds: string[]
}

/**
 * Every INSTANCE whose component is a brand-library component (or that is
 * itself named `brand:*` over a single image child) becomes the plain shape on
 * the graph it is given — meant for the freshly deserialised graph, before the
 * store adopts it, so nothing is dirty and nothing enters history. Idempotent.
 */
export function detachBrandInstances(
  graph: SceneGraph,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): DetachBrandInstancesReport {
  const report: DetachBrandInstancesReport = { detached: 0, nodeIds: [] }
  // Snapshot first: the loop deletes children while `nodes` is being walked.
  for (const node of Array.from(graph.getAllNodes())) {
    if (node.type !== 'INSTANCE') continue
    const component = node.componentId ? graph.getNode(node.componentId) : undefined
    const ofBrandComponent = isBrandLibraryComponent(graph, component, vocabulary)
    const namedBrand =
      !ofBrandComponent &&
      bindingOf(node, vocabulary)?.kind === 'brand' &&
      graph.getChildren(node.id).length === 1 &&
      firstImageFill(graph.getChildren(node.id)[0].fills) !== null
    if (!ofBrandComponent && !namedBrand) continue
    const fill =
      brandImageFill(graph, node.id) ?? (component ? brandImageFill(graph, component.id) : null)
    if (!fill) continue
    const pluginData = brandPluginData(node, component ?? null)
    graph.preserveSourceMetadataDuring(() => {
      for (const childId of Array.from(node.childIds)) graph.deleteNode(childId)
      graph.updateNode(node.id, {
        type: 'RECTANGLE',
        componentId: null,
        instanceOverrides: createInstanceOverrideState(),
        fills: [fill],
        clipsContent: false,
        pluginData: pluginData as SceneNode['pluginData']
      })
    })
    report.detached += 1
    report.nodeIds.push(node.id)
  }
  return report
}

/**
 * Is the node a bound image layer the Shape control applies to: a `brand:*`
 * layer, or a `content:` image slot (`image`, the reserved `ai-image`), drawn
 * as a RECTANGLE or an ELLIPSE.
 */
export function shapeControlApplies(
  node: Pick<SceneNode, 'type' | 'name' | 'pluginData'> | null | undefined,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): node is SceneNode & { type: BrandShapeType } {
  if (!node || !isBrandShapeType(node.type)) return false
  const binding = bindingOf(node, vocabulary)
  if (!binding) return false
  if (binding.kind === 'brand') return true
  return !isContentTextSlot(vocabulary, binding.slot)
}

/**
 * Rectangle ⇄ Circle on the same node: one undoable `type` change through the
 * store, everything else untouched, selection kept. Returns false when the node
 * is not a shape the control applies to or already has that type.
 */
export function setBrandShape(
  store: EditorStore,
  nodeId: string,
  type: BrandShapeType,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): boolean {
  const node = store.graph.getNode(nodeId)
  if (!shapeControlApplies(node, vocabulary) || node.type === type) return false
  store.updateNodeWithUndo(nodeId, { type }, SHAPE_COPY.undo)
  store.requestRender()
  return true
}
