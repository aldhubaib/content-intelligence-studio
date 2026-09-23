// CI: host ⇄ Studio postMessage protocol (ADR-058 §8, Track E3c Part B;
// shrunk in Track E3d-a — FB-45).
//
// Both directions are origin-checked: the Studio only accepts messages whose
// `event.origin` is the configured app origin, and it only posts to that
// origin. Messages are plain JSON objects with a `type` discriminator; the
// `studio:` prefix is ours, the `host:` prefix is the app's.
//
// Since FB-45 the chrome lives INSIDE the Studio (File menu, title bar, save
// state), so the host only needs: the token loop, errors, the saved version
// (to refresh its own pages), the dirty flag (its `beforeunload` guard) and
// where to navigate when the person leaves through the File menu.

import { IS_BROWSER } from '@open-pencil/core/constants'

// Track E3d-c (design mode): `navigate { to: 'back' }` is File › Back to post
// (the host knows where the post lives), `saved.designId` names the NEW design
// row a save birthed, `ready.documentId` / `ready.kind` say what opened
// (`templateId` stays for older hosts).

export type StudioNavigateTarget =
  | { to: 'templates' }
  | { to: 'template'; templateId: string }
  | { to: 'new-tab' }
  | { to: 'back' }

export type StudioToHostMessage =
  | {
      type: 'studio:ready'
      templateId: string
      version: number
      proposal?: boolean
      documentId?: string
      kind?: 'template' | 'design'
    }
  | { type: 'studio:dirty'; dirty: boolean }
  | { type: 'studio:saved'; version: number; kind: 'draft' | 'version'; designId?: string }
  | { type: 'studio:renamed'; name: string }
  | { type: 'studio:error'; message: string }
  | { type: 'studio:token-expiring' }
  | ({ type: 'studio:navigate' } & StudioNavigateTarget)

export type HostToStudioMessage = { type: 'host:token'; token: string }

/** Narrow an untrusted `MessageEvent.data` to a host message, or `null`. */
export function parseHostMessage(data: unknown): HostToStudioMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (type !== 'host:token') return null
  const token = (data as { token?: unknown }).token
  return typeof token === 'string' && token.length > 0 ? { type, token } : null
}

export interface HostBridge {
  /** Post to the parent; a no-op when the page is not framed. */
  post(message: StudioToHostMessage): void
  /** Subscribe to origin-checked host messages; returns the unsubscribe. */
  onMessage(handler: (message: HostToStudioMessage) => void): () => void
  /** True when `window.parent` is a different window (the Studio is framed). */
  readonly framed: boolean
}

/** The slice of `Window` the bridge posts to. */
export interface BridgeTarget {
  postMessage(message: unknown, targetOrigin: string): void
}

/** The slice of `Window` the bridge listens on; `window` satisfies it structurally. */
export interface BridgeSelf extends BridgeTarget {
  readonly parent: BridgeTarget | null
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void
}

/**
 * Create the bridge for one app origin. `target` defaults to `window.parent`;
 * tests inject a fake window pair.
 */
export function createHostBridge(
  appOrigin: string,
  options: { self?: BridgeSelf; target?: BridgeTarget | null } = {}
): HostBridge {
  const self: BridgeSelf | null = options.self ?? (IS_BROWSER ? window : null)
  const target = options.target === undefined ? (self?.parent ?? null) : options.target
  const framed = Boolean(self && target && target !== self)
  return {
    framed,
    post(message) {
      if (!framed || !target) return
      target.postMessage(message, appOrigin)
    },
    onMessage(handler) {
      if (!self) return () => undefined
      const listener = (event: MessageEvent) => {
        if (event.origin !== appOrigin) return
        if (target && event.source !== target) return
        const message = parseHostMessage(event.data)
        if (message) handler(message)
      }
      self.addEventListener('message', listener)
      return () => self.removeEventListener('message', listener)
    }
  }
}
