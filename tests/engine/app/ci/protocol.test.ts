// CI: host ⇄ Studio postMessage bridge.
import { describe, expect, test } from 'bun:test'

import { createHostBridge, parseHostMessage, type BridgeSelf } from '@/app/ci/protocol'

type Listener = (event: MessageEvent) => void

interface FakeWindow extends BridgeSelf {
  dispatch(data: unknown, origin: string, source: unknown): void
  readonly posted: Array<{ message: unknown; origin: string }>
}

function fakeWindow(): FakeWindow {
  const listeners = new Set<Listener>()
  const posted: Array<{ message: unknown; origin: string }> = []
  return {
    parent: null,
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    postMessage: (message, origin) => posted.push({ message, origin }),
    dispatch(data, origin, source) {
      for (const listener of listeners) listener({ data, origin, source } as MessageEvent)
    },
    posted
  }
}

describe('parseHostMessage', () => {
  test('accepts the token message and nothing else (FB-45 shrank the protocol)', () => {
    expect(parseHostMessage({ type: 'host:token', token: 'x' })).toEqual({
      type: 'host:token',
      token: 'x'
    })
    expect(parseHostMessage({ type: 'host:save-version' })).toBeNull()
    expect(parseHostMessage({ type: 'host:request-close' })).toBeNull()
    expect(parseHostMessage({ type: 'host:token' })).toBeNull()
    expect(parseHostMessage({ type: 'studio:ready' })).toBeNull()
    expect(parseHostMessage('host:token')).toBeNull()
    expect(parseHostMessage(null)).toBeNull()
  })
})

describe('createHostBridge', () => {
  test('posts only to the app origin and only when framed', () => {
    const self = fakeWindow()
    const parent = fakeWindow()
    const bridge = createHostBridge('https://app.example.com', {
      self,
      target: parent
    })
    expect(bridge.framed).toBe(true)
    bridge.post({ type: 'studio:dirty', dirty: true })
    expect(parent.posted).toEqual([
      { message: { type: 'studio:dirty', dirty: true }, origin: 'https://app.example.com' }
    ])

    const unframed = createHostBridge('https://app.example.com', {
      self,
      target: self
    })
    expect(unframed.framed).toBe(false)
    unframed.post({ type: 'studio:ready', templateId: 't', version: 1 })
    expect(self.posted).toEqual([])
  })

  test('ignores messages from another origin or another window', () => {
    const self = fakeWindow()
    const parent = fakeWindow()
    const bridge = createHostBridge('https://app.example.com', {
      self,
      target: parent
    })
    const received: unknown[] = []
    const stop = bridge.onMessage((message) => received.push(message))

    self.dispatch({ type: 'host:token', token: 'evil' }, 'https://evil.example.com', parent)
    self.dispatch({ type: 'host:token', token: 'stranger' }, 'https://app.example.com', {})
    self.dispatch({ type: 'host:token', token: 'first' }, 'https://app.example.com', parent)
    self.dispatch({ type: 'host:token', token: 'new' }, 'https://app.example.com', parent)
    expect(received).toEqual([
      { type: 'host:token', token: 'first' },
      { type: 'host:token', token: 'new' }
    ])

    stop()
    self.dispatch({ type: 'host:token', token: 'late' }, 'https://app.example.com', parent)
    expect(received).toHaveLength(2)
  })
})
