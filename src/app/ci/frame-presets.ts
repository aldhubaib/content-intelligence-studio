// CI: frame presets in the hosted Studio (Track E3d-a, FB-44 §1).
//
// The Frame tool's preset list and the Frame section's resize picker show ONE
// category — **Content formats** — built from the app's `DesignFormat` catalog
// delivered in the template payload (`formats`), never hard-coded here. The
// template's own format is pinned first as "Recommended". Figma's device
// categories are not offered when hosted; standalone, upstream is untouched.

import type { FramePreset, FramePresetCategory } from '@/app/editor/frame-presets'

import type { StudioFormat } from './api'

export const CONTENT_FORMATS_CATEGORY_ID = 'content-formats' as const
export const CONTENT_FORMATS_LABEL = 'Content formats'
export const RECOMMENDED_SUFFIX = ' · Recommended'

/** `instagram_post` → `format:instagram_post` — a preset id that cannot collide with Figma's. */
export function formatPresetId(formatId: string): string {
  return `format:${formatId}`
}

export function formatPreset(format: StudioFormat, recommended = false): FramePreset {
  return {
    id: formatPresetId(format.id),
    name: recommended ? `${format.label}${RECOMMENDED_SUFFIX}` : format.label,
    width: format.width,
    height: format.height
  }
}

/**
 * The one hosted category: the current template's format first (Recommended),
 * then the rest of the catalog in the app's order. The `labelKey` is a
 * placeholder the section never reads when `label` is set.
 */
export function contentFormatsCategory(
  formats: readonly StudioFormat[],
  currentFormatId: string | null
): FramePresetCategory {
  const current = formats.find((f) => f.id === currentFormatId) ?? null
  const rest = formats.filter((f) => f.id !== current?.id)
  return {
    id: CONTENT_FORMATS_CATEGORY_ID,
    labelKey: 'framePresetCategorySocialMedia',
    label: CONTENT_FORMATS_LABEL,
    presets: [
      ...(current ? [formatPreset(current, true)] : []),
      ...rest.map((f) => formatPreset(f))
    ]
  }
}

/** The format behind a preset id, or null for a Figma preset. */
export function formatOfPresetId(
  formats: readonly StudioFormat[],
  presetId: string
): StudioFormat | null {
  if (!presetId.startsWith('format:')) return null
  const id = presetId.slice('format:'.length)
  return formats.find((f) => f.id === id) ?? null
}

/** "Instagram post · 1080 × 1350" — the read-only format line of the title bar (FB-45). */
export function formatLine(format: Pick<StudioFormat, 'label' | 'width' | 'height'>): string {
  return `${format.label} · ${format.width} × ${format.height}`
}
