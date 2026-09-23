// CI: Preview with real content — the pure half (Track E3d-b1, FB-44 §6).
//
// What a `content:*` text layer SHOWS while a preview is active, derived from
// the picked candidate (or the sample text) and the layer itself. Nothing here
// touches a graph: `preview-overlay.ts` applies these values through the
// engine's preview channel and the serializer never sees them.

import type { SceneNode, StyleRun } from '@open-pencil/scene-graph'

import type { StudioPreviewCandidate, StudioPreviewContent, StudioRoleName } from './api'

export type ContentPreviewSelection =
  | { kind: 'none' }
  | { kind: 'sample' }
  | { kind: 'candidate'; candidate: StudioPreviewCandidate }

export const PREVIEW_COPY = {
  button: 'Preview with',
  buttonActive: (title: string) => `Preview: ${title}`,
  srOnly: 'Preview content, not saved',
  heading: 'Approved Arabic candidates',
  sample: 'Sample text',
  none: 'None',
  refresh: 'Refresh',
  loading: 'Loading candidates…',
  empty: 'No approved Arabic candidates yet — approve one on Plan and it appears here.',
  unavailable: 'Preview unavailable',
  aiImage: 'AI image — coming later',
  approved: (relative: string) => `Approved ${relative}`,
  brandSection: 'Preview with',
  brandDefault: 'Default',
  brandReset: 'Reset to default',
  brandHelp: (binding: string) =>
    `Previews only — the layer stays bound to ${binding}; the pipeline picks the image at render time.`,
  brandEmpty: {
    'user-image': 'No user image yet — add one in Settings › Brand kit.',
    'company-logo-light': 'No light logo yet — add one in Settings › Brand kit.',
    'company-logo-dark': 'No dark logo yet — add one in Settings › Brand kit.'
  } as Record<string, string>
} as const

/** The `content:*` slot names that carry text, mapped to the content field they show. */
const TEXT_SLOT_FIELD: Partial<Record<string, keyof StudioPreviewContent>> = {
  title: 'title',
  subtitle: 'subtitle',
  body: 'body',
  cta: 'cta',
  'article-url': 'articleUrl'
}

export function isPreviewTextSlot(slot: string): boolean {
  return slot in TEXT_SLOT_FIELD
}

/** The text a content slot shows; null when the slot carries no text (image slots) or the value is empty. */
export function contentTextFor(slot: string, content: StudioPreviewContent): string | null {
  const field = TEXT_SLOT_FIELD[slot]
  if (!field) return null
  const value = content[field].trim()
  return value.length > 0 ? value : null
}

/** "Preview: <title>" reads the candidate's title line, "Preview: Sample text" the sample. */
export function selectionWords(selection: ContentPreviewSelection): string {
  switch (selection.kind) {
    case 'none':
      return PREVIEW_COPY.button
    case 'sample':
      return PREVIEW_COPY.buttonActive(PREVIEW_COPY.sample)
    default:
      return PREVIEW_COPY.buttonActive(selection.candidate.title || selection.candidate.id)
  }
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
    out.push({ start: run.start, length: newEnd - run.start, style: run.style })
  }
  return out
}

/**
 * The preview changes for ONE `content:*` text layer — `text` (+ remapped
 * `styleRuns`); the font and the box stay (no auto-shrink). A `repeat` frame
 * shows the first body chunk: the whole body truncated to the layer's box.
 * Null when the slot has nothing to show (empty value, image slot).
 */
export function contentPreviewChanges(
  node: Pick<SceneNode, 'text' | 'styleRuns' | 'width' | 'height' | 'fontSize' | 'lineHeight'>,
  slot: string,
  content: StudioPreviewContent,
  options: { role: StudioRoleName | null; maxChars: number | null }
): Partial<SceneNode> | null {
  let text = contentTextFor(slot, content)
  if (text === null) return null
  if (slot === 'body' && options.role === 'repeat') {
    text = truncateWithEllipsis(text, estimateBoxChars(node, options.maxChars))
  }
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
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** `?preview=<candidate id>` on open preselects that candidate when the list holds it. */
export function preselectedCandidate(
  candidates: readonly StudioPreviewCandidate[],
  id: string | null | undefined
): StudioPreviewCandidate | null {
  if (!id) return null
  return candidates.find((c) => c.id === id) ?? null
}
