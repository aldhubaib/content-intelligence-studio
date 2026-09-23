// CI: what the hosted Studio hides from, adds to and relabels in the app menu
// and the command palette (ADR-058 §8; Track E3d-a FB-45 — the File menu IS
// the chrome).
//
// The app owns documents: there is no New / Open / Recent / Save As / Close
// tab, no storage workspace, no `.fig` export and no autosave toggle (the
// session autosaves a draft every 30 s regardless). Save reads "Save version"
// — the only save word. Hosted-only entries lead back to the app: Back to
// templates, Save as new template, Open in new tab.

import { hostedSession } from './boot'
import { isHosted, isHostedDesign } from './hosted'
import { HOSTED_MENU_LABELS, hidesMenuItem } from './menu-rules'

export {
  DESIGN_HIDDEN_MENU_IDS,
  DESIGN_ONLY_MENU_IDS,
  HOSTED_HIDDEN_MENU_IDS,
  HOSTED_MENU_LABELS,
  HOSTED_ONLY_MENU_IDS,
  hidesMenuItem
} from './menu-rules'

/** True when a menu entry must not be rendered in this page. */
export function hostedHidesMenuItem(id: string): boolean {
  return hidesMenuItem(id, isHosted() ? (isHostedDesign() ? 'design' : 'template') : null)
}

/** A hosted-mode label override, or `null` to keep the translated upstream label. */
export function hostedMenuLabel(id: string): string | null {
  return isHosted() ? (HOSTED_MENU_LABELS[id] ?? null) : null
}

/** Actions behind the hosted-only entries; no-ops before the session exists. */
export const hostedMenuActions: Readonly<Record<string, () => void>> = {
  'ci-back-to-templates': () => void hostedSession.value?.backToTemplates(),
  'ci-back-to-post': () => void hostedSession.value?.backToPost(),
  'ci-save-as-new-template': () => void hostedSession.value?.saveAsNewTemplate(),
  'ci-open-in-new-tab': () => hostedSession.value?.openInNewTab()
}

/**
 * Hiding entries leaves separators next to each other or at the edges; the
 * hosted menu collapses them so the File menu reads as one list.
 */
export function collapseMenuSeparators<T extends { separator?: boolean }>(items: T[]): T[] {
  const out: T[] = []
  for (const item of items) {
    const isSeparator = 'separator' in item && item.separator === true
    if (
      isSeparator &&
      (out.length === 0 ||
        ('separator' in out[out.length - 1] && out[out.length - 1].separator === true))
    )
      continue
    out.push(item)
  }
  while (
    out.length > 0 &&
    'separator' in out[out.length - 1] &&
    out[out.length - 1].separator === true
  )
    out.pop()
  return out
}
