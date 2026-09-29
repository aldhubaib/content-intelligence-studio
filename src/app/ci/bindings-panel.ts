// CI: the Bindings panel's own rules (FB-78, PATCHES H-72) — pure, so `bun test` judges them.
//
// The panel is a collapsible section of the inspector column. Three decisions
// live here and nowhere else:
//   1. whether it opens by default (nothing to do → closed; something to do → open),
//   2. how the person's own toggle is remembered per browser (the Studio's own
//      storage key, beside the palette key — never upstream's),
//   3. what a brand-text chip says (WHERE the layer is — its role frame — never "added N times").
// The report, the verdict words and the save path are untouched: this module only reads.

import type { BindingRef, BindingsReport, RoleReport } from './bindings'

/**
 * Storage key of the person's Bindings toggle. Same family as the palette key
 * (`HOSTED_THEME_STORAGE_KEY` = `content-intelligence:studio-theme`) so a
 * standalone OpenPencil session in the same browser never sees it.
 */
export const BINDINGS_OPEN_STORAGE_KEY = 'content-intelligence:studio-bindings-open'

/** True when no layer under the page is bound at all — a freshly created document. */
export function nothingBound(report: Pick<BindingsReport, 'roles' | 'strayBindings'>): boolean {
  return report.roles.every((r) => r.bindings.length === 0) && report.strayBindings.length === 0
}

/**
 * The default state of the panel when the person has never toggled it:
 * **collapsed** when the report is Usable and every contract row is met —
 * nothing to do, the inspector below gets the column; **open** when a row is
 * not met or nothing is bound yet (a new document asks for its first frame).
 */
export function bindingsDefaultOpen(
  report: Pick<BindingsReport, 'roles' | 'strayBindings' | 'usable'> | null,
  checklist: ReadonlyArray<{ met: boolean }>
): boolean {
  if (!report) return true
  if (nothingBound(report)) return true
  if (!report.usable.single) return true
  return checklist.some((row) => !row.met)
}

/** A stored toggle wins over the default once the person has set one. */
export function resolveBindingsOpen(stored: boolean | null, defaultOpen: boolean): boolean {
  return stored ?? defaultOpen
}

/** The two words the toggle is stored as; anything else (or nothing) means "never toggled". */
export type StoredBindingsOpen = 'open' | 'closed'

/** `true` / `false` when the person toggled the panel before, `null` when never (or the value is junk). */
export function parseStoredBindingsOpen(raw: string | null | undefined): boolean | null {
  if (raw === 'open') return true
  if (raw === 'closed') return false
  return null
}

/** The stored form of a toggle. */
export function serializeBindingsOpen(open: boolean): StoredBindingsOpen {
  return open ? 'open' : 'closed'
}

/**
 * What a brand-text chip says: the ROLE FRAME that holds the layer (`cover` ·
 * `repeat` · `ending`); a layer outside every role frame reads its own layer name.
 */
export function brandTextChipWords(
  binding: Pick<BindingRef, 'frameId' | 'nodeName'>,
  roles: ReadonlyArray<Pick<RoleReport, 'role' | 'frameId'>>
): string {
  if (binding.frameId) {
    const role = roles.find((r) => r.frameId === binding.frameId)
    if (role) return role.role
  }
  return binding.nodeName
}
