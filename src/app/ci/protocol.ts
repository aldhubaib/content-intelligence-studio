// CI: host ⇄ Studio postMessage protocol (ADR-058 §8, Track E3c Part B).
//
// Both directions are origin-checked: the Studio only accepts messages whose
// `event.origin` is the configured app origin, and it only posts to that
// origin. Messages are plain JSON objects with a `type` discriminator; the
// `studio:` prefix is ours, the `host:` prefix is the app's.

import { IS_BROWSER } from '@open-pencil/core/constants'

export type StudioToHostMessage =
  | { type: 'studio:ready'; templateId: string; version: number }
  | { type: 'studio:dirty'; dirty: boolean }
  | { type: 'studio:saved'; version: number; kind: 'draft' | 'version' }
  | { type: 'studio:error'; message: string }
  | { type: 'studio:token-expiring' }
  | { type: 'studio:close-ok' }
  | { type: 'studio:close-blocked'; dirty: true }

export type HostToStudioMessage =
  | { type: 'host:token'; token: string }
  | { type: 'host:save-version' }
  | { type: 'host:request-close' }

const HOST_MESSAGE_TYPES: ReadonlySet<HostToStudioMessage['type']> = new Set([
  'host:token',
  'host:save-version',
  'host:request-close'
])

/** Narrow an untrusted `MessageEvent.data` to a host message, or `null`. */
export function parseHostMessage(data: unknown): HostToStudioMessage | null {
  if (!data || typeof data !== 'object') return null
  const type = (data as { type?: unknown }).type
  if (typeof type !== 'string' || !HOST_MESSAGE_TYPES.has(type as HostToStudioMessage['type']))
    return null
  if (type === 'host:token') {
    const token = (data as { token?: unknown }).token
    return typeof token === 'string' && token.length > 0 ? { type, token } : null
  }
  return { type } as HostToStudioMessage
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
