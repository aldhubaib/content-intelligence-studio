// CI: brand fonts in hosted mode (FB-33, ADR-058 §8).
//
// Hosted, the Studio shapes text with the workspace's brand fonts only. The
// payload's `fonts[]` is the complete list; every byte comes from the app
// origin with the bearer, and the online providers (Google / Fontsource /
// Bunny / Fontshare) are switched off so no glyph is ever fetched from a CDN.

import { fontManager } from '@open-pencil/core/text'
import { weightToStyle } from '@open-pencil/scene-graph'

import { onlineFontsEnabled } from '@/app/editor/fonts'

import type { StudioAPI, StudioFont } from './api'

/** The style name the font manager keys a face by (`Regular`, `Bold`, `Bold Italic` …). */
export function styleNameFor(weight: number, style: 'normal' | 'italic'): string {
  return weightToStyle(weight, style === 'italic')
}

export interface HostedFontReport {
  registered: string[]
  failed: Array<{ family: string; style: string; message: string }>
}

/**
 * Register every brand font with the engine and turn the online providers
 * off. Returns what was registered so the boot log and the Slots panel can
 * say it in words. A single failing font never blocks the document: the
 * engine falls back to its bundled Inter / Noto Naskh Arabic.
 */
export async function installHostedFonts(
  api: StudioAPI,
  fonts: readonly StudioFont[],
  options: { arabicFamily?: string | null; signal?: AbortSignal } = {}
): Promise<HostedFontReport> {
  onlineFontsEnabled.value = false
  fontManager.setOnlineFontProviders({})

  const byKey = new Map<string, StudioFont>()
  for (const font of fonts) {
    byKey.set(`${font.family}|${styleNameFor(font.weight, font.style)}`, font)
  }

  // Styles the payload does not carry resolve through the host loader by
  // family, so a Bold request on a Regular-only family still gets brand glyphs.
  fontManager.setHostFontLoader(async (family, style) => {
    const exact = byKey.get(`${family}|${style}`)
    const candidate = exact ?? [...byKey.values()].find((font) => font.family === family)
    if (!candidate) return null
    const bytes = await api.fetchBytes(candidate.url, options.signal)
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  })

  const report: HostedFontReport = { registered: [], failed: [] }
  await Promise.all(
    [...byKey].map(async ([key, font]) => {
      const style = styleNameFor(font.weight, font.style)
      try {
        const bytes = await api.fetchBytes(font.url, options.signal)
        const buffer = bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ) as ArrayBuffer
        fontManager.markLoaded(font.family, style, buffer, 'registered')
        report.registered.push(key)
      } catch (error) {
        report.failed.push({
          family: font.family,
          style,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  )

  // Arabic fallback chain = the brand's Arabic family when it loaded, then the
  // engine's bundled Noto Naskh Arabic (served from this origin, never a CDN).
  // With the online providers off the engine would otherwise never find an
  // Arabic face and Arabic text would measure but not paint.
  const arabic = options.arabicFamily
  if (arabic && report.registered.some((key) => key.startsWith(`${arabic}|`))) {
    fontManager.setArabicFallbackFamily(arabic)
  }
  try {
    const bundled = await fontManager.loadLocalFont(BUNDLED_ARABIC_FAMILY, 'Regular')
    if (bundled) fontManager.setArabicFallbackFamily(BUNDLED_ARABIC_FAMILY)
  } catch (error) {
    console.warn('[CI Studio] bundled Arabic fallback failed', error)
  }
  return report
}

/** The engine's bundled Arabic face (`public/NotoNaskhArabic-Regular.ttf`). */
export const BUNDLED_ARABIC_FAMILY = 'Noto Naskh Arabic'
