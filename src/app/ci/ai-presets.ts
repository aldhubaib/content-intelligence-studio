// CI: hosted AI panel presets (ADR-061 §5, Track E4 Part C).
//
// Four one-click prompts above the composer. Each preset builds an ordinary
// `ChatSubmission`: the words the person sees (`displayText`) and the fuller
// instruction the model reads (`modelText`), grounded in what the Studio
// already knows — the brand kit, the slot bindings and the frame. Nothing here
// talks to a provider; the submission goes through the same proxy as a typed
// message, so the app's server prompt and guardrails still lead.

import type { StudioBrand } from './api'
import type { SlotName, SlotReport } from './slots'

export type AIPresetId = 'fit-arabic' | 'brand-colours' | 'variants' | 'safe-areas'

export interface AIPreset {
  readonly id: AIPresetId
  /** Chip label — the words the person clicks. */
  readonly label: string
  /** Tooltip / sr description. */
  readonly description: string
}

/** Fixed order of the chips. */
export const AI_PRESETS: readonly AIPreset[] = [
  {
    id: 'fit-arabic',
    label: 'Fit Arabic copy',
    description:
      'Resize and align the text slots so Arabic copy fits right-to-left without overflow.'
  },
  {
    id: 'brand-colours',
    label: 'Apply brand colours',
    description:
      'Bind every fill and text colour to the Brand variables (primary, secondary, accent, background, text).'
  },
  {
    id: 'variants',
    label: 'Propose 3 variants',
    description: 'Add three layout variants of the current frame as new frames on this page.'
  },
  {
    id: 'safe-areas',
    label: 'Check safe areas',
    description: 'Report anything inside the platform safe-area margins and move it if it is text.'
  }
]

export interface AIPresetContext {
  readonly brand: StudioBrand | null
  readonly slots: SlotReport
  readonly requiredSlots: readonly string[]
  /** The primary frame in px when known. */
  readonly frame: { width: number; height: number } | null
  /** Selected node names, when the person selected something. */
  readonly selection: readonly string[]
}

/** The shape the chat submission needs — matches `ChatSubmission` minus attachments. */
export interface AIPresetSubmission {
  readonly modelText: string
  readonly displayText: string
}

const TEXT_SLOTS: ReadonlySet<SlotName> = new Set([
  'headline',
  'body',
  'quote',
  'attribution',
  'article_url'
])

function boundSlots(slots: SlotReport): string[] {
  return [...new Set(slots.bindings.map((b) => b.slot))]
}

function slotLine(ctx: AIPresetContext): string {
  const bound = boundSlots(ctx.slots)
  const textBound = bound.filter((s) => TEXT_SLOTS.has(s as SlotName))
  const missing = ctx.slots.missingRequired
  const parts: string[] = []
  parts.push(
    bound.length > 0
      ? `Slot layers present: ${bound.map((s) => `slot:${s}`).join(', ')}.`
      : 'No slot layers are bound yet.'
  )
  if (missing.length > 0) parts.push(`Required slots still missing: ${missing.join(', ')}.`)
  if (textBound.length > 0) parts.push(`Text slots: ${textBound.join(', ')}.`)
  return parts.join(' ')
}

function frameLine(ctx: AIPresetContext): string {
  return ctx.frame
    ? `The primary frame is ${ctx.frame.width}×${ctx.frame.height} px.`
    : 'Use the first frame on the current page as the primary frame.'
}

function brandLine(ctx: AIPresetContext): string {
  if (!ctx.brand) return 'No brand kit is bound; keep the current colours and fonts.'
  return `The Brand variables collection holds primary, secondary, accent, background and text; the Arabic face is ${ctx.brand.fontArabicFamily} and the Latin face is ${ctx.brand.fontLatinFamily}.`
}

function selectionLine(ctx: AIPresetContext): string {
  return ctx.selection.length > 0
    ? `Work on the selection first (${ctx.selection.slice(0, 5).join(', ')}${ctx.selection.length > 5 ? ', …' : ''}).`
    : ''
}

const CLOSING =
  'Use the document tools only, keep every slot:<name> layer name, and finish with one short list of what you changed. Do not export, render or fetch anything.'

/** Build the submission for a preset from the live context. Pure. */
export function buildPresetSubmission(id: AIPresetId, ctx: AIPresetContext): AIPresetSubmission {
  const preset = AI_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`Unknown AI preset: ${id}`)
  const ground = [frameLine(ctx), brandLine(ctx), slotLine(ctx), selectionLine(ctx)]
    .filter(Boolean)
    .join(' ')
  let task: string
  switch (id) {
    case 'fit-arabic':
      task =
        'Make every text slot fit Arabic copy: text direction RTL, alignment start (right), the Arabic brand face, auto-height text boxes wide enough for the sample words, and font sizes that keep the headline on at most two lines. Shrink a font size before you widen a box. Leave article_url left-to-right in the Latin face.'
      break
    case 'brand-colours':
      task =
        'Bind every fill and every text colour to a Brand variable instead of a literal colour: backgrounds to background, headline and body text to text, one accent element to accent, secondary shapes to secondary or primary. Keep contrast readable — text on background must stay clearly legible. Do not introduce colours outside the collection.'
      break
    case 'variants':
      task =
        'Create exactly three variants of the primary frame as new frames on the current page, laid out to its right with a 120 px gap and named "<frame name> · Variant 1/2/3". Vary the composition (text position, cover size, accent placement) — not the copy, colours or fonts. Every variant keeps the same slot:<name> layers.'
      break
    case 'safe-areas':
      task =
        'Check the safe areas: the top 4 %, the sides 4 % and the bottom 12 % of the primary frame are reserved for platform chrome (a 1:1 or 4:5 post) — use 8 % / 8 % / 20 % for a 9:16 story. List every layer that overlaps a margin with its distance in px, move text layers fully inside the safe area, and only report (never move) the background and cover.'
      break
  }
  return {
    displayText: preset.label,
    modelText: `${task}\n\n${ground}\n\n${CLOSING}`
  }
}

/** Selection names for the context line — pure, capped. */
export function selectionNames(nodes: ReadonlyArray<{ name: string }>): string[] {
  return nodes.map((n) => n.name).filter((n) => n.length > 0)
}

/** The primary frame size: the first FRAME child of the current page, when there is one. Pure over a minimal graph view. */
export function primaryFrameOf(
  children: ReadonlyArray<{ type: string; width?: number; height?: number }>
): { width: number; height: number } | null {
  const frame = children.find((n) => n.type === 'FRAME')
  if (!frame || typeof frame.width !== 'number' || typeof frame.height !== 'number') return null
  return { width: Math.round(frame.width), height: Math.round(frame.height) }
}
