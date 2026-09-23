// CI: Track E3d-c — the pure menu visibility rules of the hosted Studio, kept
// import-free so `bun test` reads them without the app shell (`menu.ts` is the
// door the shell uses).

export const HOSTED_HIDDEN_MENU_IDS: ReadonlySet<string> = new Set([
  'new',
  'open',
  'open-recent',
  'open-storage-workspace',
  'save-as',
  'export-fig',
  'autosave',
  'close'
])

/** Entries that exist ONLY in the hosted Studio (FB-45; Track E3d-c adds Back to post). */
export const HOSTED_ONLY_MENU_IDS: ReadonlySet<string> = new Set([
  'ci-back-to-templates',
  'ci-back-to-post',
  'ci-save-as-new-template',
  'ci-open-in-new-tab'
])

/** Track E3d-c: template-only entries a DESIGN session hides (Back to post replaces Back to templates; no Save as new template). */
export const DESIGN_HIDDEN_MENU_IDS: ReadonlySet<string> = new Set([
  'ci-back-to-templates',
  'ci-save-as-new-template'
])

/** Entries only a design session shows. */
export const DESIGN_ONLY_MENU_IDS: ReadonlySet<string> = new Set(['ci-back-to-post'])

export const HOSTED_MENU_LABELS: Readonly<Record<string, string>> = {
  save: 'Save version',
  'export-selection': 'Export image…'
}

/** Pure twin of `hostedHidesMenuItem`: `mode` null = standalone. */
export function hidesMenuItem(id: string, mode: 'template' | 'design' | null): boolean {
  if (mode === null) return HOSTED_ONLY_MENU_IDS.has(id)
  if (HOSTED_HIDDEN_MENU_IDS.has(id)) return true
  if (mode === 'design') return DESIGN_HIDDEN_MENU_IDS.has(id)
  return DESIGN_ONLY_MENU_IDS.has(id)
}
