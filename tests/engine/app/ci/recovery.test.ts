// CI: hosted mode disables OpenPencil's browser-local recovery (E3c.1 Part A).
import { afterEach, describe, expect, test } from 'bun:test'

import { reactive } from 'vue'

import { createDefaultEditorState } from '@open-pencil/core/editor'

import { bootHostedStudio, resetHostedBoot } from '@/app/ci/boot'
import { disableLocalRecovery, discardStaleRecoverySnapshots } from '@/app/ci/recovery'
import { createDocumentRecovery } from '@/app/document/recovery/controller'
import { createMemoryRecoveryStore } from '@/app/document/recovery/memory'
import { recoveryEnabled, setRecoveryRuntimeOverride } from '@/app/document/recovery/preferences'
import type { RecoveryStore } from '@/app/document/recovery/types'
import { createEditorStore } from '@/app/editor/session'

function seeded(count: number): RecoveryStore {
  const store = createMemoryRecoveryStore()
  for (let index = 0; index < count; index++) {
    void store.write({
      id: `stale-${index}`,
      documentName: `Draft ${index}`,
      sceneVersion: index,
      figBytes: new Uint8Array([index])
    })
  }
  return store
}

const originalDebug = console.debug
const originalWarn = console.warn

afterEach(() => {
  setRecoveryRuntimeOverride(null)
  resetHostedBoot()
  console.debug = originalDebug
  console.warn = originalWarn
})

describe('hosted local recovery', () => {
  test('disableLocalRecovery flips the runtime override so recoveryEnabled reads false', () => {
    expect(recoveryEnabled.value).toBe(true)
    disableLocalRecovery()
    expect(recoveryEnabled.value).toBe(false)
    // The preference itself is untouched: releasing the override brings it back.
    setRecoveryRuntimeOverride(null)
    expect(recoveryEnabled.value).toBe(true)
  })

  test('the document controller with isEnabled false neither persists nor reports a snapshot', async () => {
    const store = createMemoryRecoveryStore()
    const state = reactive({ ...createDefaultEditorState('page-1'), documentName: 'Template' })
    let builds = 0
    const recovery = createDocumentRecovery({
      state,
      store,
      recoveryId: 'hosted-doc',
      hasWritableSource: () => false,
      isEnabled: () => false,
      buildFigFile: () => {
        builds++
        return new Uint8Array([1])
      }
    })
    state.sceneVersion += 3
    await recovery.persistNow()
    expect(builds).toBe(0)
    expect(await store.list()).toEqual([])
    expect(await store.read('hosted-doc')).toBeNull()
    recovery.disposeRecovery()
  })

  test('discardStaleRecoverySnapshots clears what an earlier session left and says so', async () => {
    const store = seeded(2)
    const lines: string[] = []
    console.debug = (...args: unknown[]) => {
      lines.push(args.map(String).join(' '))
    }
    expect(await discardStaleRecoverySnapshots(store)).toBe(2)
    expect(await store.list()).toEqual([])
    expect(lines).toEqual(['[Recovery] Hosted Studio discarded 2 stale local snapshots'])
    // Nothing to discard → silent, no store write.
    expect(await discardStaleRecoverySnapshots(store)).toBe(0)
    expect(lines).toHaveLength(1)
  })

  test('a failing store is logged with the [Recovery] prefix and never throws', async () => {
    const warnings: string[] = []
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]))
    }
    const broken: RecoveryStore = {
      ...createMemoryRecoveryStore(),
      list: () => Promise.reject(new Error('IndexedDB is unavailable'))
    }
    expect(await discardStaleRecoverySnapshots(broken)).toBe(0)
    expect(warnings).toEqual(['[Recovery] Hosted Studio could not discard stale local snapshots:'])
  })

  test('a standalone boot (no ?doc) leaves the local recovery exactly as upstream has it', async () => {
    const store = createEditorStore()
    expect(await bootHostedStudio(store)).toBeNull()
    expect(recoveryEnabled.value).toBe(true)
    store.dispose()
  })
})
