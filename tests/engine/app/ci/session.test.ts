// CI: the hosted editing session over a real editor store and a fake API.
import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import {
  StudioConflictError,
  type StudioAPI,
  type StudioFormat,
  type StudioTemplatePayload
} from '@/app/ci/api'
import { DEFAULT_VOCABULARY } from '@/app/ci/bindings'
import { serializeGraph } from '@/app/ci/document'
import { hostedToken } from '@/app/ci/hosted'
import type { HostBridge, HostToStudioMessage, StudioToHostMessage } from '@/app/ci/protocol'
import {
  createHostedSession,
  hostedWindowTitle,
  isDraftName,
  RENAME_DEBOUNCE_MS,
  saveStateWords,
  type AutosaveScheduler,
  type HostedSession
} from '@/app/ci/session'
import { answerClosePrompt, closePrompt } from '@/app/document/close/prompt'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

const CONFIG = {
  templateId: 'tpl-1',
  workspaceSlug: 'nizek',
  apiOrigin: 'https://app.example.com',
  initialToken: 'tok'
}

const FORMAT: StudioFormat = {
  id: 'instagram_post',
  label: 'Instagram post',
  platform: 'INSTAGRAM',
  width: 1080,
  height: 1350,
  aspect: '4:5',
  safeInsetPct: [4, 4, 12, 4],
  slideCap: 1
}

/** A model-v3 template: a `cover` frame with an image layer (no title yet). */
function templateGraph(frameName = 'cover', imageName = 'content:image'): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, { name: frameName, width: 1080, height: 1350 })
  graph.createNode('RECTANGLE', frame.id, { name: imageName, width: 1080, height: 700 })
  return graph
}

function payload(overrides: Partial<StudioTemplatePayload> = {}): StudioTemplatePayload {
  return {
    document: serializeGraph(templateGraph(), '0.15.1'),
    name: 'Portrait card',
    version: 4,
    updatedAt: '2026-09-22T10:00:00Z',
    format: FORMAT,
    formats: [FORMAT],
    collection: null,
    brand: null,
    fonts: [],
    bindings: {
      vocabulary: DEFAULT_VOCABULARY,
      report: {
        version: 'bindings-v3',
        usable: { single: false, carousel: false },
        statusWords: ''
      }
    },
    ai: { enabled: true },
    ...overrides
  }
}

function fakeAPI(data: StudioTemplatePayload) {
  const saves: Array<{ kind: string; baseVersion: number; name?: string }> = []
  const renames: string[] = []
  const duplicates: Array<{ name?: string }> = []
  let nextVersion = data.version
  let failNext: Error | null = null
  const api: StudioAPI = {
    apiOrigin: CONFIG.apiOrigin,
    loadTemplate: async () => data,
    renameTemplate: async (name) => {
      renames.push(name)
      return { name }
    },
    duplicateTemplate: async (body) => {
      duplicates.push({ name: body.name })
      return { templateId: 'tpl-2', name: body.name ?? 'copy' }
    },
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
    renames,
    duplicates,
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

// No canvas here: upstream document paths yield through rAF and the load waits
// for the renderer to present — stand both in (`booted()` marks the canvas ready).
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
  // Stand in for the canvas: the surface exists and every scene version is presented.
  store.markCanvasReady()
  store.preparationController.acknowledgePresentation(Number.MAX_SAFE_INTEGER)
  // Records what the page held at each fit, so a test can tell "the loaded frame"
  // from "an empty page".
  const fits: string[][] = []
  const zoomToFit = store.zoomToFit
  store.zoomToFit = () => {
    fits.push(store.graph.getChildren(store.state.currentPageId).map((node) => node.name))
    zoomToFit()
  }
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
  return { store, remote, host, clock, session, aiApplied, titles, fits }
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

  test('E3c.1 Part B: the frame is fitted to the viewport exactly once per load, and never again', async () => {
    const { store, host, clock, fits, session } = await booted()
    // Once, with the loaded graph in place (the fit is what the first frame shows).
    expect(fits).toEqual([['cover']])
    expect(session.status.value).toEqual({ kind: 'ready' })
    // 1080×1350 plus the engine's 80 px padding inside the 1920×1080 test viewport.
    expect(store.state.zoom).toBeCloseTo(1080 / (1350 + 160), 3)
    expect(store.state.zoom).toBeLessThan(1)

    // Autosave, a token refresh and Save version leave the viewport alone.
    const frame = frameOf(store)
    store.updateNode(frame.id, { name: 'Renamed' })
    clock.tick()
    await settle()
    host.send({ type: 'host:token', token: 'rotated' })
    expect(await session.saveVersion()).toBe(true)
    expect(fits).toHaveLength(1)
  })

  test('loads the template into the store, names it, reports ready and stays clean', async () => {
    const { store, host, session } = await booted()
    expect(store.state.documentName).toBe('Portrait card')
    expect([...store.graph.getAllNodes()].some((node) => node.name === 'content:image')).toBe(true)
    expect(session.version.value).toBe(4)
    expect(session.dirty.value).toBe(false)
    expect(session.status.value).toEqual({ kind: 'ready' })
    expect(host.posted).toContainEqual({ type: 'studio:ready', templateId: 'tpl-1', version: 4 })
    const cover = session.bindings.value.roles.find((r) => r.role === 'cover')
    expect(cover?.present).toBe(true)
    expect(cover?.reasons.map((r) => r.code)).toEqual(['cover_without_text'])
    expect(session.bindings.value.usable.single).toBe(false)
    expect(session.saveState.value).toEqual({ kind: 'saved', version: 4 })
    expect(saveStateWords(session.saveState.value)).toBe('Saved · v4')
    expect(session.aiEnabled.value).toBe(true)
  })

  test('FB-44 §2: a legacy slot: template is migrated on load and left dirty so the next save writes v3 names', async () => {
    const { store, session } = await booted(
      payload({ document: serializeGraph(templateGraph('Portrait', 'slot:cover'), '0.15.1') })
    )
    const names = [...store.graph.getAllNodes()].map((n) => n.name)
    expect(names).toContain('cover')
    expect(names).toContain('content:image')
    expect(names).not.toContain('slot:cover')
    expect(session.dirty.value).toBe(true)
    expect(session.saveState.value).toEqual({ kind: 'unsaved' })
  })

  test('FB-44 §3: the Bindings report follows edits — a content:title text turns the cover OK', async () => {
    const { store, session } = await booted()
    const frame = frameOf(store)
    store.createShape('TEXT', 10, 10, 500, 100, frame.id, 'content:title')
    const cover = session.bindings.value.roles.find((r) => r.role === 'cover')
    expect(cover?.status).toBe('ok')
    expect(session.bindings.value.usable.single).toBe(true)
  })

  test('E4: an unsaved AI proposal is flagged on studio:ready; a plain template is not', async () => {
    const proposed = await booted(payload({ proposal: true }))
    expect(proposed.host.posted).toContainEqual({
      type: 'studio:ready',
      templateId: 'tpl-1',
      version: 4,
      proposal: true
    })
    const plain = await booted(payload({ proposal: false }))
    const ready = plain.host.posted.find(
      (m): m is { type: 'studio:ready'; proposal?: boolean } =>
        (m as { type: string }).type === 'studio:ready'
    )
    expect(ready).toBeDefined()
    expect(ready && 'proposal' in ready).toBe(false)
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
    expect(session.saveState.value).toEqual({ kind: 'saved', version: 5 })
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

  test('host messages: only the token rotates (FB-45 — the chrome is inside the Studio)', async () => {
    const { host } = await booted()
    host.send({ type: 'host:token', token: 'rotated' })
    expect(hostedToken.value).toBe('rotated')
  })

  test('FB-45: Back to templates leaves at once when clean, asks once when dirty', async () => {
    const { store, host, remote, session } = await booted()
    expect(await session.backToTemplates()).toBe(true)
    expect(host.posted.at(-1)).toEqual({ type: 'studio:navigate', to: 'templates' })

    const frame = frameOf(store)
    store.updateNode(frame.id, { name: 'Renamed' })
    const cancelled = session.backToTemplates()
    await settle()
    expect(closePrompt.value).toEqual({ documentName: 'Portrait card' })
    answerClosePrompt('cancel')
    expect(await cancelled).toBe(false)
    expect(host.posted.filter((m) => m.type === 'studio:navigate')).toHaveLength(1)

    const discarded = session.backToTemplates()
    await settle()
    answerClosePrompt('discard')
    expect(await discarded).toBe(true)
    expect(host.posted.at(-1)).toEqual({ type: 'studio:navigate', to: 'templates' })
    expect(remote.saves).toEqual([])
  })

  test('FB-45: Save as new template duplicates through the app and navigates to the copy; Open in new tab asks the host', async () => {
    const { host, remote, session } = await booted()
    expect(await session.saveAsNewTemplate()).toBe(true)
    expect(remote.duplicates).toEqual([{ name: 'Portrait card copy' }])
    expect(host.posted.at(-1)).toEqual({
      type: 'studio:navigate',
      to: 'template',
      templateId: 'tpl-2'
    })
    session.openInNewTab()
    expect(host.posted.at(-1)).toEqual({ type: 'studio:navigate', to: 'new-tab' })
  })

  test('FB-45: an inline rename reaches renameTemplate once the name settles; Draft names show the mark', async () => {
    expect(isDraftName('Draft')).toBe(true)
    expect(isDraftName('Draft 2')).toBe(true)
    expect(isDraftName('Drafting board')).toBe(false)
    const { store, host, remote } = await booted()
    store.state.documentName = 'Land'
    store.state.documentName = 'Landscape card'
    await new Promise((resolve) => {
      setTimeout(resolve, RENAME_DEBOUNCE_MS + 20)
    })
    expect(remote.renames).toEqual(['Landscape card'])
    expect(host.posted.at(-1)).toEqual({ type: 'studio:renamed', name: 'Landscape card' })
  })

  test('a stored draft is opened and left dirty so it becomes a version on the next save', async () => {
    const draftGraph = templateGraph()
    const frame = [...draftGraph.getAllNodes()].find((node) => node.name === 'cover')
    if (!frame) throw new Error('Expected the template frame')
    draftGraph.updateNode(frame.id, { name: 'cover', x: 300 })
    draftGraph.createNode('TEXT', frame.id, { name: 'From draft' })
    const { store, session } = await booted(
      payload({
        draft: { document: serializeGraph(draftGraph, '0.15.1'), savedAt: '2026-09-22T10:05:00Z' }
      })
    )
    expect([...store.graph.getAllNodes()].some((node) => node.name === 'From draft')).toBe(true)
    expect(session.dirty.value).toBe(true)
  })
})
