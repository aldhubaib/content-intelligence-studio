// CI: hosted mode has no browser-local recovery (ADR-058 §8, Track E3c.1 Part A).
//
// Upstream OpenPencil snapshots every unsaved document into IndexedDB
// (`src/app/document/recovery/*`) and offers "Recover unsaved work" on the next
// boot. Hosted, the only recovery is the app's server draft slot: a local copy
// keyed by document could offer another template's content, resurrect text the
// person already discarded on the server, or leak a template between workspaces
// on a shared machine. So the hosted boot turns the runtime override off before
// the session loads — `recoveryEnabled` is what the per-document controller
// (`isEnabled`) and the startup dialog (`RecoveryDialog.vue`) both read — and
// discards, best effort, whatever an earlier standalone or pre-E3c.1 session
// left in the store.

import { setRecoveryRuntimeOverride } from '@/app/document/recovery/preferences'
import { getRecoveryStore } from '@/app/document/recovery/store'
import type { RecoveryStore } from '@/app/document/recovery/types'

/** Turn the local recovery off for this page: no snapshot written, no prompt offered. */
export function disableLocalRecovery(): void {
  setRecoveryRuntimeOverride(false)
}

/**
 * Remove every snapshot already in the browser's recovery store. Never throws
 * and never blocks the load: a failure is logged with the upstream `[Recovery]`
 * prefix and the session goes on without it. Resolves to the number discarded.
 */
export async function discardStaleRecoverySnapshots(
  store: RecoveryStore = getRecoveryStore()
): Promise<number> {
  try {
    const stale = await store.list()
    if (stale.length === 0) return 0
    await store.clear()
    console.debug(
      `[Recovery] Hosted Studio discarded ${stale.length} stale local snapshot${stale.length === 1 ? '' : 's'}`
    )
    return stale.length
  } catch (error) {
    console.warn('[Recovery] Hosted Studio could not discard stale local snapshots:', error)
    return 0
  }
}
