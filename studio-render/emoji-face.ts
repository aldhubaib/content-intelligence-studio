// CI: the render sidecar's emoji fallback face (ADR-058 Addendum "Emoji
// fallback face", fix-design-emoji-face; PATCHES H-69). Twin of the app's
// `src/lib/emoji-coverage.ts` — the ONE rule for which characters the bundled
// face is answerable for, and the loader that reads its bytes from the image.
//
// The brand faces the app sends are merged `@fontsource` subsets with no emoji
// glyphs, and the engine's paragraph chain (primary → Inter → Arabic fallbacks
// → CJK fallbacks) had nothing to shape 💪🏼✨ with: emoji have no script class,
// so no fallback was asked for and the node settled `exhausted` — a 422
// `fonts_not_ready` under the strict policy. The sidecar registers the face at
// boot under `EMOJI_FALLBACK_FAMILY` and appends it as the LAST family of every
// paragraph. It is bundled in the image (production `node_modules`), never
// sent by the app: `428 fonts_missing` keeps meaning a BRAND face is missing.
//
// "Emoji" is exactly three Unicode classes — Extended_Pictographic, Emoji_Modifier,
// Emoji_Component (ZWJ, VS16, keycap, tags, regional indicators; the ASCII
// `#`, `*`, `0`–`9` are plain Latin the brand face covers first). Arabic,
// Latin, digits and punctuation stay the brand face's job and a real gap there
// is still `fonts_not_ready`.

/** Family name the face is registered under and appended to the paragraph chain. */
export const EMOJI_FALLBACK_FAMILY = 'Noto Color Emoji'

/** Style key of the one registered face (the font ships one weight). */
export const EMOJI_FALLBACK_STYLE = 'Regular'

/** The package the bytes ship in — byte-identical to what the app registers. */
export const EMOJI_FALLBACK_FONT_PACKAGE = '@fontsource/noto-color-emoji'

/**
 * The FULL Noto Color Emoji COLRv1 font (OFL 1.1), relative to the package
 * root — the numbered files are `unicode-range` slices for CSS, this one is
 * the whole font. CanvasKit takes the WOFF as it ships.
 */
export const EMOJI_FALLBACK_FONT_FILE = 'files/noto-color-emoji-emoji-400-normal.woff'

const EMOJI_CLASS_RE = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Emoji_Component}]$/u

/** Is this ONE code point in one of the three emoji classes? */
export function isEmojiClassCharacter(character: string): boolean {
  return EMOJI_CLASS_RE.test(character)
}

/** Is this code point one the EMOJI FACE is the answer for — emoji-class and outside ASCII? */
export function needsEmojiFallback(character: string): boolean {
  const cp = character.codePointAt(0)
  return cp !== undefined && cp > 0x7f && isEmojiClassCharacter(character)
}

/** The distinct code points of `text` only the emoji face covers, in first-seen order. */
export function emojiFallbackCharacters(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const ch of text) {
    if (seen.has(ch) || !needsEmojiFallback(ch)) continue
    seen.add(ch)
    out.push(ch)
  }
  return out
}

/** Code points as `U+1F4AA` words for an error line. */
export function codePointWords(characters: readonly string[]): string {
  return characters
    .map((ch) => `U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}`)
    .join(' ')
}

/**
 * One `fontIssues` line for a text node that settled `exhausted` while the
 * face is NOT registered: names the face and the emoji it would have shaped, so
 * the 422 reads as a deployment gap, not a brand-font gap. `null` when the node
 * carries no emoji — the gap is real. Same words as the app's engine.
 */
export function emojiFaceMissingIssue(nodeName: string, text: string): string | null {
  const chars = emojiFallbackCharacters(text)
  if (chars.length === 0) return null
  return `${EMOJI_FALLBACK_FAMILY} ${EMOJI_FALLBACK_STYLE} (missing — emoji in “${nodeName}”: ${chars.join('')} ${codePointWords(chars)})`
}

/** Absolute path of the bundled file, resolved through the module system (never a hard-coded `node_modules`). */
export function emojiFallbackFontPath(): string {
  const manifest = import.meta.resolve(`${EMOJI_FALLBACK_FONT_PACKAGE}/package.json`)
  return decodeURIComponent(new URL(EMOJI_FALLBACK_FONT_FILE, manifest).pathname)
}

/** The face's bytes from the image; throws when the package is not installed where this process runs. */
export async function readEmojiFallbackFace(): Promise<ArrayBuffer> {
  return Bun.file(emojiFallbackFontPath()).arrayBuffer()
}
