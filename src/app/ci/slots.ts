// CI: slot bindings (ADR-058 §3) read from a live graph for the Slots panel.
//
// A slot is a node the pipeline fills before export. The binding lives in the
// node's plugin data (`content-intelligence` / `slot`) and, as the legacy and
// human-readable convention, in the layer name `slot:<name>`. The vocabulary
// is fixed and shared with the app (`src/design/definition.ts`).

import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

export const TEXT_SLOT_NAMES = ['headline', 'body', 'quote', 'attribution', 'article_url'] as const
export const IMAGE_SLOT_NAMES = ['cover'] as const
export type SlotName = (typeof TEXT_SLOT_NAMES)[number] | (typeof IMAGE_SLOT_NAMES)[number]
export const SLOT_NAMES: readonly SlotName[] = [...TEXT_SLOT_NAMES, ...IMAGE_SLOT_NAMES]

export const SLOT_NAME_PREFIX = 'slot:'
export const PLUGIN_ID = 'content-intelligence'
export const PLUGIN_SLOT_KEY = 'slot'
export const PLUGIN_MAX_CHARS_KEY = 'maxChars'

export function isSlotName(raw: string): raw is SlotName {
  return (SLOT_NAMES as readonly string[]).includes(raw)
}

export function isTextSlot(slot: SlotName): boolean {
  return (TEXT_SLOT_NAMES as readonly string[]).includes(slot)
}

type PluginEntry = { pluginId: string; key: string; value: string }

export function pluginValue(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  const entries = Array.isArray(node.pluginData) ? (node.pluginData as PluginEntry[]) : []
  const hit = entries.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)
  return hit ? hit.value : null
}

/** Slot a node is bound to: plugin data first, `slot:<name>` name as the fallback. */
export function slotOf(node: Pick<SceneNode, 'name' | 'pluginData'>): SlotName | null {
  const fromPlugin = pluginValue(node, PLUGIN_SLOT_KEY)
  if (fromPlugin !== null) return isSlotName(fromPlugin) ? fromPlugin : null
  const name = typeof node.name === 'string' ? node.name : ''
  if (!name.startsWith(SLOT_NAME_PREFIX)) return null
  const raw = name.slice(SLOT_NAME_PREFIX.length).trim()
  return isSlotName(raw) ? raw : null
}

export interface SlotBinding {
  slot: SlotName
  nodeId: string
  nodeName: string
  nodeType: SceneNode['type']
  /** Text slot: the soft cap the pipeline truncates to; null when unset. */
  maxChars: number | null
  /** Text slot bound to a non-text node, or `cover` bound to a text node. */
  typeMismatch: boolean
}

/** Every slot binding under the page (paint order), duplicates included. */
export function listSlotBindings(graph: SceneGraph, pageId?: string): SlotBinding[] {
  const out: SlotBinding[] = []
  const page = pageId ? graph.getNode(pageId) : graph.getPages()[0]
  if (!page) return out
  const visit = (node: SceneNode) => {
    const slot = slotOf(node)
    if (slot) {
      const raw = pluginValue(node, PLUGIN_MAX_CHARS_KEY)
      const max =
        raw !== null && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null
      const text = isTextSlot(slot)
      out.push({
        slot,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        maxChars: max,
        typeMismatch: text ? node.type !== 'TEXT' : node.type === 'TEXT'
      })
    }
    for (const child of graph.getChildren(node.id)) visit(child)
  }
  for (const child of graph.getChildren(page.id)) visit(child)
  return out
}

export interface SlotReport {
  bindings: SlotBinding[]
  /** Required slots (from the API) with no binding in the document. */
  missingRequired: SlotName[]
  /** Slots bound more than once — the pipeline fills the first, the rest are stale. */
  duplicates: SlotName[]
}

export function slotReport(
  graph: SceneGraph,
  requiredSlots: readonly string[],
  pageId?: string
): SlotReport {
  const bindings = listSlotBindings(graph, pageId)
  const seen = new Map<SlotName, number>()
  for (const binding of bindings) seen.set(binding.slot, (seen.get(binding.slot) ?? 0) + 1)
  const missingRequired = requiredSlots.filter(isSlotName).filter((slot) => !seen.has(slot))
  const duplicates = [...seen].filter(([, count]) => count > 1).map(([slot]) => slot)
  return { bindings, missingRequired, duplicates }
}
