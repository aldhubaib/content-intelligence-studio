// CI: the hosted Studio's palette (ADR-058 §8, Track E3c Part F).
//
// Upstream keeps one preference — `dark` / `light` / `auto` — and one
// attribute, `html[data-theme]`. In hosted mode we leave both alone and add a
// second attribute, `html[data-palette]`, that `src/theme/carbon.css` styles:
// Dark → Carbon Gray 100 (the Content Intelligence app's own theme), Light →
// Carbon Gray 10. Their theme switch therefore keeps working unchanged, and
// the hosted preference has its own storage key so it never leaks into a
// standalone OpenPencil session in the same browser (or the other way round).

import { isHosted } from './hosted'

export type CarbonPalette = 'carbon-g100' | 'carbon-g10'

/** Storage key of the hosted theme preference (upstream: `open-pencil:theme`). */
export const HOSTED_THEME_STORAGE_KEY = 'content-intelligence:studio-theme'

/** The palette for a resolved upstream theme when hosted, `null` in standalone mode. */
export function hostedPalette(
  resolved: 'dark' | 'light',
  hosted = isHosted()
): CarbonPalette | null {
  if (!hosted) return null
  return resolved === 'light' ? 'carbon-g10' : 'carbon-g100'
}

/** The theme storage key for this page — hosted sessions never share upstream's. */
export function themeStorageKey(hosted = isHosted()): string {
  return hosted ? HOSTED_THEME_STORAGE_KEY : 'open-pencil:theme'
}
