// CI: FB-64 — Option+Arrow nudges while measurements are shown.
import { afterEach, beforeEach, describe, expect, test, vi } from 'bun:test'

import { createEditorStore, type EditorStore } from '@/app/editor/session'
import { bindNudgeKeys } from '@/app/shell/keyboard/nudging'

type ModifierFlags = Partial<Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'metaKey' | 'ctrlKey'>>

/**
 * Bun has no DOM: a bare EventTarget stands in for `window`. The events report an empty
 * composed path so `isEditing` never reaches the element classes a browser would supply.
 */
function keydown(code: string, flags: ModifierFlags = {}): KeyboardEvent {
  const event = Object.assign(new Event('keydown', { cancelable: true }), {
    code,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ctrlKey: false,
    composedPath: (): EventTarget[] => [],
    ...flags
  })
  return event as KeyboardEvent
}

const stores: EditorStore[] = []

function storeWithOneSelectedNode(): EditorStore {
  const store = createEditorStore()
  stores.push(store)
  const page = store.graph.getPages()[0]
  const node = store.graph.createNode('RECTANGLE', page.id, { x: 10, y: 10, width: 100, height: 100 })
  store.select([node.id])
  return store
}

let target: EventTarget
let originalWindow: Window & typeof globalThis

beforeEach(() => {
  originalWindow = globalThis.window
  target = new EventTarget()
  globalThis.window = target as Window & typeof globalThis
})

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
  if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window')
  else globalThis.window = originalWindow
})

describe('bindNudgeKeys (FB-64)', () => {
  test('Option+Arrow nudges 1 px — holding Option for measurements never disables the arrows', () => {
    const store = storeWithOneSelectedNode()
    const nudge = vi.spyOn(store, 'nudgeSelected')
    bindNudgeKeys(store)

    const event = keydown('ArrowDown', { altKey: true })
    target.dispatchEvent(event)

    expect(nudge).toHaveBeenCalledTimes(1)
    expect(nudge).toHaveBeenCalledWith(0, 1)
    expect(event.defaultPrevented).toBe(true)
  })

  test('Option+Shift+Arrow nudges 10 px (Figma)', () => {
    const store = storeWithOneSelectedNode()
    const nudge = vi.spyOn(store, 'nudgeSelected')
    bindNudgeKeys(store)

    target.dispatchEvent(keydown('ArrowDown', { altKey: true, shiftKey: true }))

    expect(nudge).toHaveBeenCalledTimes(1)
    expect(nudge).toHaveBeenCalledWith(0, 10)
  })

  test('Meta / Ctrl + Arrow still belong to the browser — no nudge', () => {
    const store = storeWithOneSelectedNode()
    const nudge = vi.spyOn(store, 'nudgeSelected')
    bindNudgeKeys(store)

    target.dispatchEvent(keydown('ArrowDown', { metaKey: true }))
    target.dispatchEvent(keydown('ArrowDown', { ctrlKey: true }))

    expect(nudge).not.toHaveBeenCalled()
  })
})
