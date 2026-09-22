// CI: hosted-mode boot (ADR-058 §8, Track E3c Part B).
//
// `WorkspaceView` calls `bootHostedStudio()` once after its first tab exists.
// Standalone (`?doc` absent) this is a no-op and the page is upstream
// OpenPencil. Hosted, it creates the one session for the page, registers the
// Save override and loads the template into the active store.

import { shallowRef } from 'vue'

import type { EditorStore } from '@/app/editor/session'
import { toast } from '@/app/shell/ui'

import { hostedConfig, hostedConfigError, isHosted } from './hosted'
import { setHostedSaveHandler } from './save-override'
import { createHostedSession, type HostedSession } from './session'

/** The page's hosted session; `null` standalone or before boot. */
export const hostedSession = shallowRef<HostedSession | null>(null)

let bootPromise: Promise<HostedSession | null> | null = null

export function bootHostedStudio(store: EditorStore): Promise<HostedSession | null> {
  if (bootPromise) return bootPromise
  bootPromise = (async () => {
    if (hostedConfigError) {
      toast.error(hostedConfigError)
      return null
    }
    if (!isHosted() || !hostedConfig) return null
    const session = createHostedSession({ config: hostedConfig, store })
    hostedSession.value = session
    setHostedSaveHandler(() => session.saveVersion())
    try {
      await session.load()
    } catch (error) {
      // `load` already toasted and told the host; keep the session so the
      // Slots panel / status line can show the error state in words.
      console.error('[CI Studio] load failed', error)
    }
    return session
  })()
  return bootPromise
}

/** Test hook: forget the page session so a fresh boot can run. */
export function resetHostedBoot(): void {
  hostedSession.value?.dispose()
  hostedSession.value = null
  setHostedSaveHandler(null)
  bootPromise = null
}
