// CI: hosted AI panel presets (ADR-061 §5, Track E4 Part C).
//
// Four one-click prompts above the composer. Each preset builds an ordinary
// `ChatSubmission`: the words the person sees (`displayText`) and the fuller
// instruction the model reads (`modelText`), grounded in what the Studio
// already knows — the brand kit, the layer bindings (model v3, FB-44) and the
// frame. Nothing here talks to a provider; the submission goes through the
// same proxy as a typed message, so the app's server prompt and guardrails
// still lead.

import type { StudioBrand } from './api'
import {
  bindingName,
  bindingReasonWords,
  DEFAULT_VOCABULARY,
  isContentTextSlot,
  type BindingsReport
} from './bindings'

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
    description: 'Bind every fill and text colour to the two Brand variables (primary, secondary).'
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
  readonly bindings: BindingsReport
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

function bindingLine(ctx: AIPresetContext): string {
  const parts: string[] = []
  const bound = new Set<string>()
  const textBound = new Set<string>()
  for (const role of ctx.bindings.roles) {
    if (!role.present) continue
    for (const b of role.bindings) {
      bound.add(bindingName(b.binding))
      if (b.binding.kind === 'content' && isContentTextSlot(DEFAULT_VOCABULARY, b.binding.slot))
        textBound.add(b.binding.slot)
    }
  }
  parts.push(
    bound.size > 0
      ? `Bound layers present: ${[...bound].join(', ')}.`
      : 'No content: or brand: layers are bound yet.'
  )
  const missing = ctx.bindings.roles
    .filter((r) => r.present && r.status === 'missing')
    .flatMap((r) => r.reasons.map(bindingReasonWords))
  if (missing.length > 0) parts.push(`Still missing: ${missing.join('; ')}.`)
  if (textBound.size > 0) parts.push(`Text slots: ${[...textBound].join(', ')}.`)
  return parts.join(' ')
}

function frameLine(ctx: AIPresetContext): string {
  return ctx.frame
    ? `The primary frame is ${ctx.frame.width}×${ctx.frame.height} px.`
    : 'Use the first frame on the current page as the primary frame.'
}

function brandLine(ctx: AIPresetContext): string {
  if (!ctx.brand) return 'No brand kit is bound; keep the current colours and fonts.'
  const assets = ctx.brand.assets.map((a) =>
    bindingName({ kind: 'brand', slotKind: a.kind, name: a.name })
  )
  return `The Brand variables collection holds two colours, $brand/primary (${ctx.brand.colors.primary}) and $brand/secondary (${ctx.brand.colors.secondary}); fonts are the template's own.${assets.length > 0 ? ` Brand assets available as layers: ${assets.join(', ')}.` : ''}`
}

function selectionLine(ctx: AIPresetContext): string {
  return ctx.selection.length > 0
    ? `Work on the selection first (${ctx.selection.slice(0, 5).join(', ')}${ctx.selection.length > 5 ? ', …' : ''}).`
    : ''
}

const CLOSING =
  'Use the document tools only, keep every content:<slot> and brand:<kind> layer name and the cover / repeat / ending frame names, and finish with one short list of what you changed. Do not export, render or fetch anything.'

/** Build the submission for a preset from the live context. Pure. */
export function buildPresetSubmission(id: AIPresetId, ctx: AIPresetContext): AIPresetSubmission {
  const preset = AI_PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`Unknown AI preset: ${id}`)
  const ground = [frameLine(ctx), brandLine(ctx), bindingLine(ctx), selectionLine(ctx)]
    .filter(Boolean)
    .join(' ')
  let task: string
  switch (id) {
    case 'fit-arabic':
      task =
        'Make every text slot fit Arabic copy: text direction RTL, alignment start (right), the Arabic brand face, auto-height text boxes wide enough for the sample words, and font sizes that keep the headline on at most two lines. Shrink a font size before you widen a box. Leave content:article-url left-to-right in the Latin face.'
      break
    case 'brand-colours':
      task =
        'Bind every fill and every text colour to a Brand variable instead of a literal colour: large surfaces to $brand/primary or $brand/secondary, text to whichever of the two reads clearly against its background (white or near-black literal text is allowed where neither does). Keep contrast readable. Do not introduce other colours.'
      break
    case 'variants':
      task =
        'Create exactly three variants of the primary frame as new frames on the current page, laid out to its right with a 120 px gap and named "<frame name> · Variant 1/2/3". Vary the composition (text position, cover size, accent placement) — not the copy, colours or fonts. Every variant keeps the same content:<slot> and brand:<kind> layers.'
      break
    case 'safe-areas':
      task =
        'Check the safe areas: the top 4 %, the sides 4 % and the bottom 12 % of the primary frame are reserved for platform chrome (a 1:1 or 4:5 post) — use 8 % / 8 % / 20 % for a 9:16 story. List every layer that overlaps a margin with its distance in px, move text layers fully inside the safe area, and only report (never move) the background and the content:image layer.'
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
