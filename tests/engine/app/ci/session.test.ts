// CI: the hosted editing session over a real editor store and a fake API.
import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import { StudioConflictError, type StudioAPI, type StudioTemplatePayload } from '@/app/ci/api'
import { serializeGraph } from '@/app/ci/document'
import { hostedToken } from '@/app/ci/hosted'
import type { HostBridge, HostToStudioMessage, StudioToHostMessage } from '@/app/ci/protocol'
import {
  createHostedSession,
  hostedWindowTitle,
  type AutosaveScheduler,
  type HostedSession
} from '@/app/ci/session'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

const CONFIG = {
  templateId: 'tpl-1',
  workspaceSlug: 'nizek',
  apiOrigin: 'https://app.example.com',
  initialToken: 'tok'
}

function templateGraph(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, { name: 'Portrait', width: 1080, height: 1350 })
  graph.createNode('RECTANGLE', frame.id, { name: 'slot:cover', width: 1080, height: 700 })
  return graph
}

function payload(overrides: Partial<StudioTemplatePayload> = {}): StudioTemplatePayload {
  return {
    document: serializeGraph(templateGraph(), '0.15.1'),
    name: 'Portrait card',
    version: 4,
    updatedAt: '2026-09-22T10:00:00Z',
    brand: null,
    fonts: [],
    requiredSlots: ['headline', 'cover'],
    ai: { enabled: true },
    ...overrides
  }
}

function fakeAPI(data: StudioTemplatePayload) {
  const saves: Array<{ kind: string; baseVersion: number; name?: string }> = []
  let nextVersion = data.version
  let failNext: Error | null = null
  const api: StudioAPI = {
    apiOrigin: CONFIG.apiOrigin,
    loadTemplate: async () => data,
    saveTemplate: async (body) => {
      saves.push({ kind: body.kind, baseVersion: body.baseVersion, name: body.name })
      if (failNext) {
        const error = failNext
        failNext = null
        throw error
      }
      nextVersion += 1
      return { version: nextVersion, updatedAt: 'later' }
    },
    fetchBytes: async () => new Uint8Array(),
    aiChatURL: () => `${CONFIG.apiOrigin}/api/studio/ai/chat`
  }
  return {
    api,
    saves,
    failNextWith(error: Error) {
      failNext = error
    }
  }
}

function fakeBridge() {
  const posted: StudioToHostMessage[] = []
  const handlers = new Set<(message: HostToStudioMessage) => void>()
  const bridge: HostBridge = {
    framed: true,
    post: (message) => posted.push(message),
    onMessage: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    }
  }
  return {
    bridge,
    posted,
    send(message: HostToStudioMessage) {
      for (const handler of handlers) handler(message)
    }
  }
}

interface FakeScheduler extends AutosaveScheduler {
  tick(): void
  readonly started: number
  readonly stopped: number
}

function fakeScheduler(): FakeScheduler {
  const ticks: Array<() => void> = []
  const scheduler = {
    started: 0,
    stopped: 0,
    start(tick: () => void) {
      ticks.push(tick)
      scheduler.started++
      return () => {
        scheduler.stopped++
      }
    },
    tick() {
      for (const tick of ticks) tick()
    }
  }
  return scheduler
}

/** Let queued microtasks and zero-delay timers run. */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

function frameOf(store: EditorStore): SceneNode {
  const frame = [...store.graph.getAllNodes()].find(
    (node) => node.type === 'FRAME' && node.parentId
  )
  if (!frame) throw new Error('Expected the template frame')
  return frame
}

let session: HostedSession | null = null

// No canvas here: `fitCurrentPageToViewport` yields through rAF and the page
// switch waits for the renderer to present — stand both in.
const testGlobal: { requestAnimationFrame?: (callback: (time: number) => void) => number } =
  globalThis
testGlobal.requestAnimationFrame ??= (callback) => {
  setTimeout(() => callback(performance.now()), 0)
  return 0
}

afterEach(() => {
  session?.dispose()
  session = null
})

async function booted(data = payload()) {
  const store = createEditorStore()
  store.preparationController.acknowledgePresentation(Number.MAX_SAFE_INTEGER)
  const remote = fakeAPI(data)
  const host = fakeBridge()
  const clock = fakeScheduler()
  const aiApplied: Array<StudioTemplatePayload['ai']> = []
  const titles: string[] = []
  session = createHostedSession({
    config: CONFIG,
    store,
    api: remote.api,
    bridge: host.bridge,
    autosave: clock,
    skipBrandLibrary: true,
    skipFonts: true,
    applyAI: (ai) => aiApplied.push(ai),
    setTitle: (title) => titles.push(title)
  })
  await session.load()
  return { store, remote, host, clock, session, aiApplied, titles }
}

describe('hosted session', () => {
  test("Part F: the payload's ai block reaches the AI binding once per load, models defaulted", async () => {
    const { aiApplied } = await booted(
      payload({ ai: { enabled: true, models: [{ id: 'gpt-4o', label: 'GPT-4o' }] } })
    )
    expect(aiApplied).toEqual([{ enabled: true, models: [{ id: 'gpt-4o', label: 'GPT-4o' }] }])
    const off = await booted(payload({ ai: { enabled: false } }))
    expect(off.aiApplied).toEqual([{ enabled: false, models: [] }])
  })

  test('Part F: the window title is the template name, and follows an inline rename', async () => {
    expect(hostedWindowTitle('Portrait card')).toBe('Portrait card · Content Intelligence Studio')
    expect(hostedWindowTitle('   ')).toBe('Content Intelligence Studio')
    const { store, titles } = await booted()
    expect(titles).toEqual(['Portrait card · Content Intelligence Studio'])
    store.state.documentName = 'Landscape card'
    await settle()
    expect(titles.at(-1)).toBe('Landscape card · Content Intelligence Studio')
  })

  test('loads the template into the store, names it, reports ready and stays clean', async () => {
    const { store, host, session } = await booted()
    expect(store.state.documentName).toBe('Portrait card')
    expect([...store.graph.getAllNodes()].some((node) => node.name === 'slot:cover')).toBe(true)
    expect(session.version.value).toBe(4)
    expect(session.dirty.value).toBe(false)
    expect(session.status.value).toEqual({ kind: 'ready' })
    expect(host.posted).toContainEqual({ type: 'studio:ready', templateId: 'tpl-1', version: 4 })
    expect(session.slots.value.missingRequired).toEqual(['headline'])
    expect(session.aiEnabled.value).toBe(true)
  })

  test('an edit makes the document dirty and tells the host; Save version PUTs a version', async () => {
    const { store, host, remote, session } = await booted()
    const frame = frameOf(store)
    store.updateNode(frame.id, { name: 'Renamed' })
    expect(session.dirty.value).toBe(true)
    expect(host.posted).toContainEqual({ type: 'studio:dirty', dirty: true })

    const ok = await session.saveVersion()
    expect(ok).toBe(true)
    expect(remote.saves).toEqual([{ kind: 'version', baseVersion: 4, name: 'Portrait card' }])
    expect(session.version.value).toBe(5)
    expect(session.dirty.value).toBe(false)
    expect(host.posted).toContainEqual({ type: 'studio:saved', version: 5, kind: 'version' })
  })

  test('autosave sends a draft every interval only while dirty', async () => {
    const { store, remote, clock, session } = await booted()
    expect(clock.started).toBe(1)
    clock.tick()
    await Promise.resolve()
    expect(remote.saves).toEqual([])

    const frame = frameOf(store)
    store.updateNode(frame.id, { name: 'Renamed' })
    clock.tick()
    await settle()
    expect(remote.saves).toEqual([{ kind: 'draft', baseVersion: 4, name: 'Portrait card' }])
    expect(session.dirty.value).toBe(false)
  })

  test('a 409 becomes the conflict state; Save version then saves on top of the server', async () => {
    const { store, remote, session } = await booted()
    const frame = frameOf(store)
    store.updateNode(frame.id, { name: 'Renamed' })
    remote.failNextWith(new StudioConflictError(9))
    expect(await session.saveVersion()).toBe(false)
    expect(session.status.value).toEqual({ kind: 'conflict', serverVersion: 9 })
    // Autosave holds while the conflict is unresolved.
    expect(await session.saveDraft()).toBe(false)

    expect(await session.saveVersion()).toBe(true)
    expect(remote.saves.map((s) => s.baseVersion)).toEqual([4, 9])
    expect(session.status.value).toEqual({ kind: 'ready' })
  })

  test('host messages: token rotates, save-version saves, request-close answers by dirtiness', async () => {
    const { store, host, remote, session } = await booted()
    host.send({ type: 'host:token', token: 'rotated' })
    expect(hostedToken.value).toBe('rotated')

    host.send({ type: 'host:request-close' })
    expect(host.posted.at(-1)).toEqual({ type: 'studio:close-ok' })

    const frame = frameOf(store)
    store.updateNode(frame.id, { name: 'Renamed' })
    host.send({ type: 'host:request-close' })
    expect(host.posted.at(-1)).toEqual({ type: 'studio:close-blocked', dirty: true })

    host.send({ type: 'host:save-version' })
    await settle()
    expect(remote.saves).toEqual([{ kind: 'version', baseVersion: 4, name: 'Portrait card' }])
    expect(session.dirty.value).toBe(false)
  })

  test('a stored draft is opened and left dirty so it becomes a version on the next save', async () => {
    const draftGraph = templateGraph()
    const frame = [...draftGraph.getAllNodes()].find((node) => node.name === 'Portrait')
    if (!frame) throw new Error('Expected the template frame')
    draftGraph.updateNode(frame.id, { name: 'From draft' })
    const { store, session } = await booted(
      payload({
        draft: { document: serializeGraph(draftGraph, '0.15.1'), savedAt: '2026-09-22T10:05:00Z' }
      })
    )
    expect([...store.graph.getAllNodes()].some((node) => node.name === 'From draft')).toBe(true)
    expect(session.dirty.value).toBe(true)
  })
})
