// CI: binding model v3 over a live graph (Track E3d-a, FB-44 §2 / §3; ADR-058 §3).
//
// A template is a set of ROLE FRAMES — `cover` · `repeat` · `ending`, the
// top-level frames of the first page — whose layers are BOUND BY NAME:
// `content:<slot>` for what the pipeline writes, `brand:<kind>[:<asset>]` for
// what the workspace brand kit supplies. The vocabulary is closed and comes
// from the app with the template payload (`bindings.vocabulary`); this file
// is the fork-side twin of the app's `src/design/bindings.ts` and speaks the
// SAME words (`src/lib/bindings-words.ts` there) so the Bindings panel, the
// catalog card and a render refusal never disagree.
//
// There is no gate on save (FB-44 §3): the report is shown, never enforced.

import type { SceneGraph, SceneNode, Vector } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/session'

import type { StudioBindingsVocabulary, StudioFormat, StudioRoleName } from './api'

export const CONTENT_PREFIX = 'content:'
export const BRAND_PREFIX = 'brand:'
export const LEGACY_SLOT_PREFIX = 'slot:'
export const ROLE_FRAMES: readonly StudioRoleName[] = ['cover', 'repeat', 'ending']

export const PLUGIN_ID = 'content-intelligence'
export const PLUGIN_SLOT_KEY = 'slot'
export const PLUGIN_MAX_CHARS_KEY = 'maxChars'

/** What the Studio assumes before the payload arrives (the app's vocabulary of this track). */
export const DEFAULT_VOCABULARY: StudioBindingsVocabulary = {
  contentText: ['title', 'subtitle', 'body', 'cta', 'article-url'],
  contentImage: ['image'],
  reserved: ['ai-image'],
  brandKinds: ['user-image', 'company-logo-light', 'company-logo-dark'],
  // CI (Track FB-69, H-68): the two brand TEXT names the kit fills.
  brandText: ['display-name', 'handle'],
  roles: [...ROLE_FRAMES],
  legacy: {
    headline: 'title',
    body: 'body',
    quote: 'body',
    attribution: 'subtitle',
    article_url: 'article-url',
    cover: 'image'
  }
}

export type Binding =
  | { kind: 'content'; slot: string }
  | { kind: 'brand'; slotKind: string; name: string | null }
  /** CI (Track FB-69, H-68): a TEXT layer the brand kit fills — `brand:display-name`, `brand:handle`. */
  | { kind: 'brand-text'; slot: string }

/** `content:title`, `brand:user-image`, `brand:user-image:Hero`, `brand:display-name` */
export function bindingName(binding: Binding): string {
  if (binding.kind === 'content') return `${CONTENT_PREFIX}${binding.slot}`
  if (binding.kind === 'brand-text') return `${BRAND_PREFIX}${binding.slot}`
  return binding.name
    ? `${BRAND_PREFIX}${binding.slotKind}:${binding.name}`
    : `${BRAND_PREFIX}${binding.slotKind}`
}

/** CI (Track FB-69): `display-name` / `handle` when the app's vocabulary names them; never on an older app. */
export function isBrandTextSlot(vocabulary: StudioBindingsVocabulary, slot: string): boolean {
  return vocabulary.brandText?.includes(slot) ?? false
}

/** A binding the pipeline fills with TEXT — a content text slot or a brand text slot. */
export function isTextBinding(vocabulary: StudioBindingsVocabulary, binding: Binding): boolean {
  if (binding.kind === 'brand-text') return true
  return binding.kind === 'content' && isContentTextSlot(vocabulary, binding.slot)
}

export function isContentSlot(vocabulary: StudioBindingsVocabulary, slot: string): boolean {
  return (
    vocabulary.contentText.includes(slot) ||
    vocabulary.contentImage.includes(slot) ||
    vocabulary.reserved.includes(slot)
  )
}

export function isContentTextSlot(vocabulary: StudioBindingsVocabulary, slot: string): boolean {
  return vocabulary.contentText.includes(slot)
}

/**
 * Parse a layer name. Prefixes are case-insensitive (`Content:Title` parses);
 * a legacy `slot:<name>` maps through the vocabulary's legacy table so an
 * E3b template reads as the v3 template it becomes on save.
 */
export function parseBindingName(
  raw: string,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): Binding | null {
  const trimmed = raw.trim()
  const colon = trimmed.indexOf(':')
  if (colon <= 0) return null
  const head = trimmed.slice(0, colon + 1).toLowerCase()
  const rest = trimmed.slice(colon + 1).trim()
  if (!rest) return null
  if (head === CONTENT_PREFIX) {
    const slot = rest.toLowerCase()
    return isContentSlot(vocabulary, slot) ? { kind: 'content', slot } : null
  }
  if (head === LEGACY_SLOT_PREFIX) {
    const slot = vocabulary.legacy[rest.toLowerCase()]
    return slot && isContentSlot(vocabulary, slot) ? { kind: 'content', slot } : null
  }
  if (head === BRAND_PREFIX) {
    const second = rest.indexOf(':')
    const slotKind = (second === -1 ? rest : rest.slice(0, second)).trim().toLowerCase()
    // CI (Track FB-69): a brand TEXT slot takes no `:<name>` suffix — `brand:handle:x` is not a binding (the app's rule).
    if (isBrandTextSlot(vocabulary, slotKind))
      return second === -1 ? { kind: 'brand-text', slot: slotKind } : null
    const name = second === -1 ? null : rest.slice(second + 1).trim() || null
    return vocabulary.brandKinds.includes(slotKind) ? { kind: 'brand', slotKind, name } : null
  }
  return null
}

/**
 * Track FB-61: the roles a format's template MUST contain — the app's
 * `templateContract` twin. The payload's `contract.roles` wins when the app
 * sends it; an older app is read from `slideCap` (carousel → all three,
 * single image → cover only). Never a choice.
 */
export function contractRoles(
  format: Pick<StudioFormat, 'slideCap'> | null,
  contract?: { roles: readonly string[] } | null
): readonly StudioRoleName[] {
  if (contract && contract.roles.length > 0) {
    const roles = ROLE_FRAMES.filter((role) => contract.roles.includes(role))
    if (roles.length > 0) return roles
  }
  if (format === null) return ROLE_FRAMES
  return format.slideCap > 1 ? ROLE_FRAMES : ['cover']
}

export function roleOfFrameName(name: unknown): StudioRoleName | null {
  if (typeof name !== 'string') return null
  const lower = name.trim().toLowerCase()
  return (ROLE_FRAMES as readonly string[]).includes(lower) ? (lower as StudioRoleName) : null
}

type PluginEntry = { pluginId: string; key: string; value: string }

export function pluginValue(node: Pick<SceneNode, 'pluginData'>, key: string): string | null {
  const entries = Array.isArray(node.pluginData) ? (node.pluginData as PluginEntry[]) : []
  const hit = entries.find((entry) => entry.pluginId === PLUGIN_ID && entry.key === key)
  return hit ? hit.value : null
}

function withPluginValue(
  entries: readonly PluginEntry[] | undefined,
  key: string,
  value: string
): PluginEntry[] {
  const rest = (entries ?? []).filter((e) => !(e.pluginId === PLUGIN_ID && e.key === key))
  return [...rest, { pluginId: PLUGIN_ID, key, value }]
}

/** A plugin `slot` value → the v3 content slot it means (legacy names mapped), or null. */
function contentSlotOfPluginValue(
  value: string,
  vocabulary: StudioBindingsVocabulary
): string | null {
  const lower = value.trim().toLowerCase()
  if (isContentSlot(vocabulary, lower)) return lower
  const mapped = vocabulary.legacy[lower]
  return mapped && isContentSlot(vocabulary, mapped) ? mapped : null
}

/**
 * The binding a node carries: its NAME is authoritative; the plugin-data
 * `slot` entry is the fallback for a layer someone renamed freely.
 */
export function bindingOf(
  node: Pick<SceneNode, 'name' | 'pluginData'>,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY
): Binding | null {
  const fromName = parseBindingName(typeof node.name === 'string' ? node.name : '', vocabulary)
  if (fromName) return fromName
  const fromPlugin = pluginValue(node, PLUGIN_SLOT_KEY)
  if (fromPlugin === null) return null
  const slot = contentSlotOfPluginValue(fromPlugin, vocabulary)
  return slot ? { kind: 'content', slot } : null
}

export interface BindingRef {
  /** Canonical name (`content:title`, `brand:user-image:Hero`). */
  name: string
  binding: Binding
  nodeId: string
  nodeName: string
  nodeType: SceneNode['type']
  /** Top-level frame of the page the layer sits in; null outside every artboard. */
  frameId: string | null
  maxChars: number | null
}

function firstPage(graph: SceneGraph, pageId?: string): SceneNode | undefined {
  return pageId ? graph.getNode(pageId) : graph.getPages()[0]
}

/** Top-level frames of the page in paint order — the artboards. */
export function topLevelFrames(graph: SceneGraph, pageId?: string): SceneNode[] {
  const page = firstPage(graph, pageId)
  if (!page) return []
  return graph.getChildren(page.id).filter((node) => node.type === 'FRAME')
}

export interface RoleFrame {
  role: StudioRoleName
  frameId: string
  name: string
  width: number
  height: number
}

/** Role frames of the page; the first frame per role wins when a role is named twice. */
export function roleFrames(graph: SceneGraph, pageId?: string): RoleFrame[] {
  const seen = new Set<StudioRoleName>()
  const out: RoleFrame[] = []
  for (const frame of topLevelFrames(graph, pageId)) {
    const role = roleOfFrameName(frame.name)
    if (!role || seen.has(role)) continue
    seen.add(role)
    out.push({
      role,
      frameId: frame.id,
      name: frame.name,
      width: frame.width,
      height: frame.height
    })
  }
  return out
}

/** Every bound layer under the page, in paint order; duplicates included. */
export function listBindings(
  graph: SceneGraph,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY,
  pageId?: string
): BindingRef[] {
  const out: BindingRef[] = []
  const page = firstPage(graph, pageId)
  if (!page) return out
  const visit = (node: SceneNode, frameId: string | null) => {
    const binding = bindingOf(node, vocabulary)
    if (binding) {
      const raw = pluginValue(node, PLUGIN_MAX_CHARS_KEY)
      const max =
        raw !== null && Number.isFinite(Number(raw)) && Number(raw) > 0 ? Number(raw) : null
      out.push({
        name: bindingName(binding),
        binding,
        nodeId: node.id,
        nodeName: node.name,
        nodeType: node.type,
        frameId,
        maxChars: max
      })
    }
    for (const child of graph.getChildren(node.id)) visit(child, frameId)
  }
  for (const child of graph.getChildren(page.id)) {
    visit(child, child.type === 'FRAME' ? child.id : null)
  }
  return out
}

// ---------------------------------------------------------------------------
// The report and its words (mirror of the app's `bindings.ts` + `bindings-words.ts`)
// ---------------------------------------------------------------------------

export type BindingReason =
  | { code: 'no_cover' }
  | { code: 'cover_without_text' }
  | { code: 'repeat_without_body' }
  | { code: 'duplicate_binding'; name: string; count: number }
  | { code: 'text_on_shape'; name: string }
  | { code: 'image_on_text'; name: string }

export interface RoleReport {
  role: StudioRoleName
  /** CI (Track FB-61): the format's contract names this role. */
  inContract: boolean
  present: boolean
  frameId: string | null
  bindings: BindingRef[]
  status: 'ok' | 'missing'
  reasons: BindingReason[]
}

export interface BindingsReport {
  version: 'bindings-v3'
  roles: RoleReport[]
  /** Bound layers outside every role frame — never rendered, listed so the person sees them. */
  strayBindings: BindingRef[]
  usable: { single: boolean; carousel: boolean }
  /** CI (Track FB-61): the roles the format's contract names. */
  contractRoles: readonly StudioRoleName[]
  /** Role frames present that the contract does not name — "Not used by this format". */
  unusedRoles: StudioRoleName[]
}

export const ROLE_LABELS: Record<StudioRoleName, string> = {
  cover: 'Cover',
  repeat: 'Repeat',
  ending: 'Ending'
}

export const BINDINGS_USABLE = 'Usable'
export const BINDINGS_NOT_USABLE_PREFIX = 'Not usable yet — '

export const BLOCKING: ReadonlySet<BindingReason['code']> = new Set([
  'no_cover',
  'cover_without_text',
  'repeat_without_body'
])

export function bindingReasonWords(reason: BindingReason): string {
  switch (reason.code) {
    case 'no_cover':
      return 'there is no cover frame'
    case 'cover_without_text':
      return 'cover has no content:title or content:body'
    case 'repeat_without_body':
      return 'repeat has no content:body'
    case 'duplicate_binding':
      return `${reason.name} is bound to ${reason.count} layers`
    case 'text_on_shape':
      return `${reason.name} must be a text layer`
    default:
      return `${reason.name} must be an image or shape layer`
  }
}

/** "Usable" / "Not usable yet — cover has no content:title or content:body" */
export function bindingsStatusWords(roles: readonly RoleReport[]): string {
  const blocking = roles.flatMap((r) => r.reasons.filter((reason) => BLOCKING.has(reason.code)))
  if (blocking.length === 0) return BINDINGS_USABLE
  return `${BINDINGS_NOT_USABLE_PREFIX}${bindingReasonWords(blocking[0])}`
}

/** CI (Track FB-61): a role frame the format never renders — the app's `ROLE_UNUSED_WORDS`. */
export const ROLE_UNUSED_WORDS = 'Not used by this format'

/** "Cover · OK" / "Repeat · repeat has no content:body" / "Ending · not added" / "Repeat · not used by this format" */
export function roleStatusWords(role: RoleReport): string {
  if (!role.present) return `${ROLE_LABELS[role.role]} · not added`
  if (!role.inContract) return `${ROLE_LABELS[role.role]} · ${ROLE_UNUSED_WORDS.toLowerCase()}`
  if (role.status === 'ok') return `${ROLE_LABELS[role.role]} · OK`
  const words = role.reasons.length > 0 ? bindingReasonWords(role.reasons[0]) : 'missing'
  return `${ROLE_LABELS[role.role]} · ${words}`
}

// CI (Track FB-69, PATCHES H-68): the Bindings panel's **Brand text** rows.
export const BRAND_TEXT_COPY = {
  heading: 'Brand text',
  lead: 'Optional text layers the brand kit fills — never required.',
  notAdded: 'not added — optional',
  /** The jump chip's words: "added" / "added 2 times" (the same name on several layers). */
  present: (count: number) => (count === 1 ? 'added' : `added ${count} times`)
} as const

export interface BrandTextRow {
  /** `brand:display-name` */
  name: string
  slot: string
  /** The app's description of the name; null when it sent none. */
  description: string | null
  /** Every layer carrying the name — inside a role frame or stray. */
  layers: BindingRef[]
}

/**
 * One row per `vocabulary.brandText` name with the layers that carry it
 * (role frames first, strays after) and the app's description. Empty on an
 * older app that sends no `brandText` — the panel then shows no section.
 */
export function brandTextRows(
  report: Pick<BindingsReport, 'roles' | 'strayBindings'>,
  vocabulary: StudioBindingsVocabulary
): BrandTextRow[] {
  const names = vocabulary.brandText ?? []
  if (names.length === 0) return []
  const all = [...report.roles.flatMap((r) => r.bindings), ...report.strayBindings]
  return names.map((slot) => {
    const name = `${BRAND_PREFIX}${slot}`
    const words = vocabulary.descriptions?.[name]
    return {
      name,
      slot,
      description: typeof words === 'string' && words.trim() ? words : null,
      layers: all.filter((b) => b.binding.kind === 'brand-text' && b.binding.slot === slot)
    }
  })
}

function shapeProblems(
  bindings: readonly BindingRef[],
  vocabulary: StudioBindingsVocabulary
): BindingReason[] {
  const reasons: BindingReason[] = []
  const counts = new Map<string, number>()
  for (const b of bindings) {
    counts.set(b.name, (counts.get(b.name) ?? 0) + 1)
    // CI (Track FB-69): a brand text binding is a text layer too — never blocking, a shape under it is the one warning.
    const isText = isTextBinding(vocabulary, b.binding)
    if (isText && b.nodeType !== 'TEXT') reasons.push({ code: 'text_on_shape', name: b.name })
    if (!isText && b.nodeType === 'TEXT') reasons.push({ code: 'image_on_text', name: b.name })
  }
  for (const [name, count] of counts)
    if (count > 1) reasons.push({ code: 'duplicate_binding', name, count })
  return reasons
}

function has(bindings: readonly BindingRef[], name: string): boolean {
  return bindings.some((b) => b.name === name)
}

/** The report over the live graph against the template's format. */
export function bindingsReport(
  graph: SceneGraph,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY,
  format: Pick<StudioFormat, 'slideCap'> | null = null,
  pageId?: string,
  contract: { roles: readonly string[] } | null = null
): BindingsReport {
  const frames = roleFrames(graph, pageId)
  const all = listBindings(graph, vocabulary, pageId)
  const roleFrameIds = new Set(frames.map((f) => f.frameId))
  // CI (Track FB-61): the roles the format's contract names; a role outside it is never judged.
  const inContractRoles = contractRoles(format, contract)
  const roles: RoleReport[] = ROLE_FRAMES.map((role) => {
    const inContract = inContractRoles.includes(role)
    const frame = frames.find((f) => f.role === role) ?? null
    const bindings = frame ? all.filter((b) => b.frameId === frame.frameId) : []
    const reasons: BindingReason[] = []
    if (role === 'cover') {
      if (!frame) reasons.push({ code: 'no_cover' })
      else if (!has(bindings, 'content:title') && !has(bindings, 'content:body'))
        reasons.push({ code: 'cover_without_text' })
    }
    if (role === 'repeat' && inContract && frame && !has(bindings, 'content:body'))
      reasons.push({ code: 'repeat_without_body' })
    if (frame) reasons.push(...shapeProblems(bindings, vocabulary))
    const blocking = reasons.some((r) => BLOCKING.has(r.code))
    return {
      role,
      inContract,
      present: Boolean(frame),
      frameId: frame?.frameId ?? null,
      bindings,
      status: blocking ? 'missing' : 'ok',
      reasons
    }
  })
  const cover = roles[0]
  const repeat = roles[1]
  const single = cover.present && cover.status === 'ok'
  const carousel =
    single && inContractRoles.includes('repeat') && repeat.present && repeat.status === 'ok'
  return {
    version: 'bindings-v3',
    roles,
    strayBindings: all.filter((b) => b.frameId === null || !roleFrameIds.has(b.frameId)),
    usable: { single, carousel },
    contractRoles: inContractRoles,
    unusedRoles: roles.filter((r) => r.present && !r.inContract).map((r) => r.role)
  }
}

// ---------------------------------------------------------------------------
// Migration on load (FB-44 §2) — runs once, through the store, marks dirty
// ---------------------------------------------------------------------------

export interface LegacyMigrationReport {
  renamedLayers: number
  /** The first artboard was named `cover` because no frame carried a role. */
  roleFrameNamed: boolean
  changed: boolean
}

/**
 * Every `slot:<name>` layer takes its `content:*` name, the plugin-data `slot`
 * entry is rewritten to the v3 slot, and when NO top-level frame carries a
 * role the first artboard becomes `cover`. Goes through `update` (the store)
 * so the change tracker sees it: the next save writes the names back.
 */
export function migrateLegacyBindings(
  graph: SceneGraph,
  update: (id: string, changes: Partial<SceneNode>) => void,
  vocabulary: StudioBindingsVocabulary = DEFAULT_VOCABULARY,
  pageId?: string
): LegacyMigrationReport {
  const report: LegacyMigrationReport = {
    renamedLayers: 0,
    roleFrameNamed: false,
    changed: false
  }
  const frames = topLevelFrames(graph, pageId)
  if (frames.length > 0 && !frames.some((f) => roleOfFrameName(f.name) !== null)) {
    update(frames[0].id, { name: 'cover' })
    report.roleFrameNamed = true
    report.changed = true
  }
  for (const node of graph.getAllNodes()) {
    if (node.id === graph.rootId || node.type === 'CANVAS') continue
    const name = typeof node.name === 'string' ? node.name : ''
    const legacyName = name.trim().toLowerCase().startsWith(LEGACY_SLOT_PREFIX)
      ? parseBindingName(name, vocabulary)
      : null
    const pluginSlot = pluginValue(node, PLUGIN_SLOT_KEY)
    const legacyPlugin =
      pluginSlot !== null && !isContentSlot(vocabulary, pluginSlot.trim().toLowerCase())
        ? contentSlotOfPluginValue(pluginSlot, vocabulary)
        : null
    const binding: Binding | null =
      legacyName ?? (legacyPlugin ? { kind: 'content', slot: legacyPlugin } : null)
    if (!binding) continue
    const changes: Partial<SceneNode> = {}
    if (legacyName) {
      changes.name = bindingName(binding)
      report.renamedLayers += 1
    }
    if (pluginSlot !== null && binding.kind === 'content') {
      changes.pluginData = withPluginValue(
        node.pluginData as PluginEntry[] | undefined,
        PLUGIN_SLOT_KEY,
        binding.slot
      ) as SceneNode['pluginData']
    }
    update(node.id, changes)
    report.changed = true
  }
  return report
}

// ---------------------------------------------------------------------------
// Add role frame ▾ (FB-44 §2)
// ---------------------------------------------------------------------------

/** Gap between artboards when a role frame is added to the right of the last one. */
export const ROLE_FRAME_GAP = 120

/**
 * Where a new role frame goes: to the right of the right-most top-level frame,
 * aligned with the first frame's top; at the origin on an empty page.
 */
export function nextRoleFramePosition(graph: SceneGraph, pageId?: string): Vector {
  const frames = topLevelFrames(graph, pageId)
  if (frames.length === 0) return { x: 0, y: 0 }
  const right = Math.max(...frames.map((f) => f.x + f.width))
  return { x: right + ROLE_FRAME_GAP, y: frames[0].y }
}

/**
 * Create the `<role>` frame at the format's size and select it. Returns the
 * new node id, or null when the role already exists (the menu item is disabled
 * in that case; this is the belt to its braces).
 */
export function addRoleFrame(
  store: EditorStore,
  role: StudioRoleName,
  format: Pick<StudioFormat, 'width' | 'height'>
): string | null {
  if (roleFrames(store.graph, store.state.currentPageId).some((f) => f.role === role)) return null
  const { x, y } = nextRoleFramePosition(store.graph, store.state.currentPageId)
  const id = store.createShape('FRAME', x, y, format.width, format.height, undefined, role)
  store.select([id])
  store.requestRender()
  return id
}
