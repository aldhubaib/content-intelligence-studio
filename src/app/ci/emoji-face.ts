// CI: the hosted EDITOR's emoji fallback face (PATCHES H-71, follow-up of
// H-69 — app ADR-058 Addendum "Emoji fallback face").
//
// H-69 gave the render sidecar (`studio-render/emoji-face.ts`) ONE bundled
// colour emoji face, appended as the LAST family of every paragraph, so a
// design with 💪🏼✨ renders in colour on Plan / Publish. The browser canvas had
// none: the same layer showed tofu while a person edited it and colour in the
// rendered PNG. The editor must show what the render shows, so hosted mode
// registers the SAME face — the same package, the same file, byte-identical
// to what the sidecar and the app's in-process engine register.
//
// The bytes are a Vite asset of THIS origin (content-hashed into
// `dist/assets/`, served immutable by nginx like every other asset), never a
// CDN: the hosted rule is that no glyph comes from outside the app / studio
// origins. The face is fetched AFTER the brand fonts and never blocks the
// document — a missing file logs once and the editor goes on; the render is
// still the contract.

import emojiFaceAssetURL from '@fontsource/noto-color-emoji/files/noto-color-emoji-emoji-400-normal.woff?url'

import { fontManager } from '@open-pencil/core/text'

// CI: the two registration constants are duplicated from `studio-render/emoji-face.ts`
// (that module reads its bytes through `Bun.file`, so the browser bundle cannot import
// it); `tests/engine/app/ci/emoji-face.test.ts` asserts the twins stay equal.

/** Family name the face is registered under and appended to the paragraph chain — H-69's. */
export const EMOJI_FALLBACK_FAMILY = 'Noto Color Emoji'

/** Style key of the one registered face (the font ships one weight) — H-69's. */
export const EMOJI_FALLBACK_STYLE = 'Regular'

/** The asset URL Vite emitted for the bundled WOFF (same origin as the Studio). */
export const EMOJI_FACE_ASSET_URL: string = emojiFaceAssetURL

/** The one boot-log line per outcome; the hosted e2e reads these words. */
export const EMOJI_FACE_LOG = {
  registered: '[CI Studio] emoji-face-registered',
  missing: '[CI Studio] emoji-face-missing'
} as const

/** What `installEmojiFace` did — the session's report reads `registered`. */
export type EmojiFaceResult =
  | { registered: true; family: string; style: string; bytes: number; alreadyLoaded: boolean }
  | { registered: false; family: string; style: string; message: string }

/** The three font-manager calls the loader makes — injectable so a test never touches the singleton. */
export type EmojiFaceFonts = Pick<
  typeof fontManager,
  'isStyleLoaded' | 'markLoaded' | 'setCJKFallbackFamily'
>

export interface EmojiFaceOptions {
  /** Where the bytes are; defaults to the Vite asset of this origin. */
  url?: string
  /** The fetch that reads them; defaults to the page's. Same origin — no bearer. */
  fetch?: typeof globalThis.fetch
  fonts?: EmojiFaceFonts
  /** Receives the one boot-log line; defaults to the console. */
  log?: (line: string) => void
  signal?: AbortSignal
}

function defaultLog(line: string): void {
  if (line.startsWith(EMOJI_FACE_LOG.missing)) console.warn(line)
  else console.debug(line)
}

/**
 * Register the bundled colour emoji face and make it the LAST family of every
 * paragraph. The same call chain the sidecar uses (`studio-render/engine.ts`
 * `registerEmojiFallbackFace`): `markLoaded(…, 'registered')` then
 * `setCJKFallbackFamily` — core has no emoji fallback list of its own and the
 * CJK slot is the one `resolveParagraphFontFamilies` appends after the primary
 * face, Inter and the Arabic fallbacks, so a glyph nothing earlier covers lands
 * here and a glyph the brand face has never does.
 *
 * Never throws: a failed fetch is one log line and `{ registered: false }`.
 */
export async function installEmojiFace(options: EmojiFaceOptions = {}): Promise<EmojiFaceResult> {
  const fonts = options.fonts ?? fontManager
  const log = options.log ?? defaultLog
  const url = options.url ?? EMOJI_FACE_ASSET_URL
  const family = EMOJI_FALLBACK_FAMILY
  const style = EMOJI_FALLBACK_STYLE

  if (fonts.isStyleLoaded(family, style)) {
    fonts.setCJKFallbackFamily(family)
    return { registered: true, family, style, bytes: 0, alreadyLoaded: true }
  }
  try {
    const doFetch = options.fetch ?? globalThis.fetch
    const response = await doFetch(url, { signal: options.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength === 0) throw new Error(`empty response for ${url}`)
    fonts.markLoaded(family, style, bytes, 'registered')
    fonts.setCJKFallbackFamily(family)
    log(`${EMOJI_FACE_LOG.registered} ${family} ${style} (${bytes.byteLength} bytes)`)
    return { registered: true, family, style, bytes: bytes.byteLength, alreadyLoaded: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log(`${EMOJI_FACE_LOG.missing} ${family} ${style}: ${message}`)
    return { registered: false, family, style, message }
  }
}

/** The renderer methods a "fonts arrived" redraw needs — the engine's own `loadFonts` tail. */
export interface EmojiFaceRenderer {
  syncFontGeneration(): void
  invalidateAllPictures(): void
}

/**
 * Ask every canvas to re-shape its text once the face is in the chain: the
 * text preparation cache is keyed by the font manager's registration
 * generation, so syncing it and dropping the pictures makes the next frame
 * rebuild each paragraph with the new family list (the tail of core's
 * `loadFonts` — `syncFontGeneration` + `invalidateAllPictures` — then one
 * render request). Nothing here touches the document.
 */
export function redrawTextForEmojiFace(
  renderers: Iterable<EmojiFaceRenderer | null | undefined>,
  requestRender: () => void
): number {
  const distinct = new Set<EmojiFaceRenderer>()
  for (const renderer of renderers) if (renderer) distinct.add(renderer)
  for (const renderer of distinct) {
    renderer.syncFontGeneration()
    renderer.invalidateAllPictures()
  }
  requestRender()
  return distinct.size
}
