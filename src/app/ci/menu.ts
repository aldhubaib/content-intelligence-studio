// CI: what the hosted Studio hides from the app menu and the command palette.
//
// The app owns documents: there is no New / Open / Recent / Save As / Close
// tab, no storage workspace, no `.fig` export and no autosave toggle (the
// session autosaves a draft every 30 s regardless). Save reads "Save version".

import { isHosted } from './hosted'

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

export const HOSTED_MENU_LABELS: Readonly<Record<string, string>> = {
  save: 'Save version'
}

/** True when a menu entry must not be rendered in this page. */
export function hostedHidesMenuItem(id: string): boolean {
  return isHosted() && HOSTED_HIDDEN_MENU_IDS.has(id)
}

/** A hosted-mode label override, or `null` to keep the translated upstream label. */
export function hostedMenuLabel(id: string): string | null {
  return isHosted() ? (HOSTED_MENU_LABELS[id] ?? null) : null
}
