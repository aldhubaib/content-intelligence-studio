// CI: Preview with real content — the pure half (Track E3d-b1, FB-44 §6).
//
// What a `content:*` text layer SHOWS while a preview is active, derived from
// the picked candidate (or the sample text) and the layer itself. Nothing here
// touches a graph: `preview-overlay.ts` applies these values through the
// engine's preview channel and the serializer never sees them.

import type { SceneNode, StyleRun } from '@open-pencil/scene-graph'

import type {
  StudioPreviewCandidate,
  StudioPreviewContent,
  StudioPreviewGroup,
  StudioRoleName
} from './api'

export type ContentPreviewSelection =
  | { kind: 'none' }
  | { kind: 'sample' }
  | { kind: 'candidate'; candidate: StudioPreviewCandidate }

export const PREVIEW_COPY = {
  button: 'Preview with',
  buttonActive: (title: string) => `Preview: ${title}`,
  srOnly: 'Preview content, not saved',
  heading: 'Approved Arabic candidates',
  /** Track fb74-studio-preview-kinds (H-70): the second section — an article's derived kinds. */
  kindsHeading: 'Article kinds',
  sample: 'Sample text',
  none: 'None',
  refresh: 'Refresh',
  loading: 'Loading candidates…',
  empty: 'No approved Arabic candidates yet — approve one on Plan and it appears here.',
  kindsEmpty: 'No article kinds yet — Like an idea on Plan and its kinds appear here.',
  unavailable: 'Preview unavailable',
  aiImage: 'AI image — coming later',
  approved: (relative: string) => `Approved ${relative}`,
  /** A kind candidate's time line: when its copy was written. */
  written: (relative: string) => `Written ${relative}`,
  /** "<Kind name> · <piece title>" — a kind row's title; the kind name alone when the piece has no title. */
  kindRow: (kindName: string, pieceTitle: string) =>
    pieceTitle ? `${kindName} · ${pieceTitle}` : kindName,
  brandSection: 'Preview with',
  brandDefault: 'Default',
  brandReset: 'Reset to default',
  brandHelp: (binding: string) =>
    `Previews only — the layer stays bound to ${binding}; the pipeline picks the image at render time.`,
  /** Track E3d-c (design mode): the title-row words where **Preview with ▾** would be, and the locked-text hint. */
  designFixed: 'Content from the post',
  designFixedSr: 'The post’s text fills the content layers; it is not part of the design document',
  designLockedHint: 'Text comes from the post — edit the draft on Plan.',
  /** Track FB-69 (H-68, design mode): a `brand:display-name` / `brand:handle` layer is the kit's, not the design's. */
  brandLockedHint: 'This text comes from the brand kit — edit it on Settings › Brand kit.',
  /** Track FB-69: the inspector section label over a selected brand text layer in design mode. */
  brandFixed: 'Text from the brand kit',
  brandEmpty: {
    'user-image': 'No user image yet — add one in Settings › Brand kit.',
    'company-logo-light': 'No light logo yet — add one in Settings › Brand kit.',
    'company-logo-dark': 'No dark logo yet — add one in Settings › Brand kit.'
  } as Record<string, string>
} as const

/** The `content:*` slot names that carry text, mapped to the content field they show. */
type PreviewTextField = 'title' | 'subtitle' | 'body' | 'cta' | 'articleUrl'
const TEXT_SLOT_FIELD: Partial<Record<string, PreviewTextField>> = {
  title: 'title',
  subtitle: 'subtitle',
  body: 'body',
  cta: 'cta',
  'article-url': 'articleUrl'
}

/** Track fb74-studio-preview-kinds (H-70): the kind-only text slots, read from `content.slots`. */
export const KIND_TEXT_SLOTS = ['number', 'step'] as const
export type KindTextSlot = (typeof KIND_TEXT_SLOTS)[number]

export function isPreviewTextSlot(slot: string): boolean {
  return slot in TEXT_SLOT_FIELD || (KIND_TEXT_SLOTS as readonly string[]).includes(slot)
}

/**
 * The text a content slot shows; null when the slot carries no text (image
 * slots) or the value is empty. `content:number` reads `slots.number`;
 * `content:step` reads `slots.step[stepIndex]` (H-70) — a candidate without
 * the slot, or a layer past the last step, shows nothing (the placeholder stays).
 */
export function contentTextFor(
  slot: string,
  content: StudioPreviewContent,
  stepIndex: number | null = null
): string | null {
  if (slot === 'number') return nonEmpty(content.slots?.number)
  if (slot === 'step') {
    if (stepIndex === null || stepIndex < 0) return null
    return nonEmpty(content.slots?.step?.[stepIndex])
  }
  const field = TEXT_SLOT_FIELD[slot]
  if (!field) return null
  return nonEmpty(content[field])
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Track fb74-studio-preview-kinds (H-70): which step each `content:step` layer
 * shows. The layers are numbered in ONE sequence — the `cover` frame's step
 * layers first (paint order), then every `repeat` frame's in paint order — so a
 * one-layer-per-frame template reads step 1 on the cover and step 2, 3 … on the
 * repeats. A step layer on an `ending` frame, on an unnamed frame or outside
 * every frame gets no index (the placeholder stays). Pure: nothing here reads a
 * graph — the overlay hands in the refs and the frames' roles.
 */
export function stepIndexesFor(
  refs: readonly { nodeId: string; slot: string; frameId: string | null }[],
  frameRole: (frameId: string) => StudioRoleName | null
): Map<string, number> {
  const out = new Map<string, number>()
  const cover: string[] = []
  const repeat: string[] = []
  for (const ref of refs) {
    if (ref.slot !== 'step' || !ref.frameId) continue
    const role = frameRole(ref.frameId)
    if (role === 'cover') cover.push(ref.nodeId)
    else if (role === 'repeat') repeat.push(ref.nodeId)
  }
  let index = 0
  for (const nodeId of [...cover, ...repeat]) out.set(nodeId, index++)
  return out
}

/** "Preview: <title>" reads the candidate's title line — a kind's "<Kind> · <piece>" — "Preview: Sample text" the sample. */
export function selectionWords(selection: ContentPreviewSelection): string {
  switch (selection.kind) {
    case 'none':
      return PREVIEW_COPY.button
    case 'sample':
      return PREVIEW_COPY.buttonActive(PREVIEW_COPY.sample)
    default:
      return PREVIEW_COPY.buttonActive(candidateRowTitle(selection.candidate))
  }
}

/** The words a candidate is listed under: a kind row "<Kind name> · <piece title>", else the title line, else the id. */
export function candidateRowTitle(candidate: StudioPreviewCandidate): string {
  if (candidate.kind) return PREVIEW_COPY.kindRow(candidate.kind.nameEn, candidate.kind.pieceTitle)
  return candidate.title || candidate.id
}

/**
 * Track fb74-studio-preview-kinds (H-70): the menu's sections. An app that
 * sends `groups` names them; an older app's flat list is ONE Arabic section.
 * Every candidate of every group is also in the flat list the overlay picks
 * from, so `?preview=<id>` and Refresh work the same for both shapes.
 */
export function previewGroupsOf(body: {
  candidates?: StudioPreviewCandidate[]
  groups?: StudioPreviewGroup[]
}): { candidates: StudioPreviewCandidate[]; groups: StudioPreviewGroup[] } {
  const flat = Array.isArray(body.candidates) ? body.candidates : []
  const sent = Array.isArray(body.groups)
    ? body.groups.filter(
        (g: unknown): g is StudioPreviewGroup =>
          typeof g === 'object' &&
          g !== null &&
          typeof (g as { key?: unknown }).key === 'string' &&
          Array.isArray((g as { candidates?: unknown }).candidates)
      )
    : []
  if (sent.length === 0) {
    return {
      candidates: flat,
      groups: [{ key: 'arabic', label: PREVIEW_COPY.heading, candidates: flat }]
    }
  }
  const groups = sent.map((g) => ({
    key: g.key,
    label: typeof g.label === 'string' && g.label ? g.label : PREVIEW_COPY.heading,
    candidates: g.candidates
  }))
  const seen = new Set<string>()
  const candidates: StudioPreviewCandidate[] = []
  for (const c of [...flat, ...groups.flatMap((g) => g.candidates)]) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    candidates.push(c)
  }
  return { candidates, groups }
}

/** The content a selection previews with; null for None. */
export function contentOf(
  selection: ContentPreviewSelection,
  sampleText: StudioPreviewContent | null
): StudioPreviewContent | null {
  if (selection.kind === 'none') return null
  if (selection.kind === 'sample') return sampleText
  return selection.candidate
}

/**
 * Truncate `text` to at most `max` characters on a word boundary with "…";
 * the text as written when it fits.
 */
export function truncateWithEllipsis(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  if (max === 1) return '…'
  const cut = text.slice(0, max - 1)
  const boundary = cut.search(/\s\S*$/u)
  const head = boundary > max / 2 ? cut.slice(0, boundary) : cut
  return `${head.replace(/[\s،,;:.]+$/u, '')}…`
}

/**
 * How many characters a text layer's box holds, estimated from its size, font
 * size and line height (an average Arabic / Latin glyph is ≈ 0.55 em wide).
 * `maxChars` (the layer's own `maxChars` plugin value) wins when set.
 */
export function estimateBoxChars(
  node: Pick<SceneNode, 'width' | 'height' | 'fontSize' | 'lineHeight'>,
  maxChars: number | null = null
): number {
  if (maxChars !== null && maxChars > 0) return Math.floor(maxChars)
  const fontSize = node.fontSize > 0 ? node.fontSize : 16
  const lineHeight = node.lineHeight && node.lineHeight > 0 ? node.lineHeight : fontSize * 1.2
  const perLine = Math.max(1, Math.floor(node.width / (fontSize * 0.55)))
  const lines = Math.max(1, Math.floor(node.height / lineHeight))
  return perLine * lines
}

/**
 * Style runs after the text changed length: a run that reached the old end
 * stretches to the new end (the whole-text styling most templates carry), a
 * run inside the text is clamped, a run past the new end is dropped.
 */
export function remapStyleRuns(
  runs: readonly StyleRun[],
  oldLength: number,
  newLength: number
): StyleRun[] {
  const out: StyleRun[] = []
  for (const run of runs) {
    if (run.start >= newLength) continue
    const end = run.start + run.length
    const newEnd = end >= oldLength ? newLength : Math.min(end, newLength)
    if (newEnd <= run.start) continue
    out.push({
      start: run.start,
      length: newEnd - run.start,
      style: run.style
    })
  }
  return out
}

/**
 * The preview changes for ONE `content:*` text layer — `text` (+ remapped
 * `styleRuns`); the font and the box stay (no auto-shrink). A `repeat` frame
 * shows the first body chunk: the app's own `bodyChunks[0]` when the content
 * carries the chunks (Track E3d-c design mode — the same words the render
 * will use), else the whole body truncated to the layer's box.
 * Null when the slot has nothing to show (empty value, image slot). A
 * `content:step` layer shows `slots.step[options.stepIndex]` (H-70).
 */
export function contentPreviewChanges(
  node: Pick<SceneNode, 'text' | 'styleRuns' | 'width' | 'height' | 'fontSize' | 'lineHeight'>,
  slot: string,
  content: StudioPreviewContent,
  options: {
    role: StudioRoleName | null
    maxChars: number | null
    stepIndex?: number | null
  }
): Partial<SceneNode> | null {
  let text = contentTextFor(slot, content, options.stepIndex ?? null)
  if (text === null) return null
  if (slot === 'body' && options.role === 'repeat') {
    const chunk = content.bodyChunks?.[0]?.trim()
    text = chunk ? chunk : truncateWithEllipsis(text, estimateBoxChars(node, options.maxChars))
  }
  return textPreviewChanges(node, text)
}

/**
 * The preview changes that put `text` on ONE text layer: `text` plus the style
 * runs remapped to the new length; the font and the box stay. An empty string
 * is a value too (Track FB-69: a kit without a handle paints an empty layer,
 * never the placeholder) — the runs collapse to none.
 */
export function textPreviewChanges(
  node: Pick<SceneNode, 'text' | 'styleRuns'>,
  text: string
): Partial<SceneNode> {
  const current = typeof node.text === 'string' ? node.text : ''
  const changes: Partial<SceneNode> = { text }
  if (Array.isArray(node.styleRuns) && node.styleRuns.length > 0) {
    changes.styleRuns = remapStyleRuns(node.styleRuns, current.length, text.length)
  }
  return changes
}

/** "just now" · "5 min ago" · "3 h ago" · "2 d ago" · a date. */
export function relativeTimeWords(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.max(0, Math.round((now.getTime() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} d ago`
  return new Date(then).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

/** `?preview=<candidate id>` on open preselects that candidate when the list holds it. */
export function preselectedCandidate(
  candidates: readonly StudioPreviewCandidate[],
  id: string | null | undefined
): StudioPreviewCandidate | null {
  if (!id) return null
  return candidates.find((c) => c.id === id) ?? null
}
