// CI: the hosted editing session (ADR-058 §8, Track E3c Part B).
//
// One template, one tab, one API. The session loads the document into the
// Studio's first tab, keeps the app informed over the host bridge, autosaves
// a draft every 30 s while the document is dirty, and turns the File → Save
// command (⌘S) into "Save version". Nothing here touches `.fig`: the wire
// format is the app's `openpencil-scene-graph` JSON, end to end.

import { useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import { applyImportedDocument } from '@/app/document/io/imported-document'
import type { EditorStore } from '@/app/editor/session'
import { toast } from '@/app/shell/ui'

import {
  StudioConflictError,
  StudioUnauthorizedError,
  createStudioAPI,
  type StudioAPI,
  type StudioTemplatePayload
} from './api'
import { installBrandLibrary, type BrandLibraryReport } from './brand-library'
import { deserializeGraph, resolveBrandStrings, serializeGraph } from './document'
import { installHostedFonts, type HostedFontReport } from './fonts'
import { hostedToken, scrubTokenFromLocation, type HostedConfig } from './hosted'
import { createHostBridge, type HostBridge } from './protocol'
import { slotReport, type SlotReport } from './slots'

export const AUTOSAVE_INTERVAL_MS = 30_000
/** The engine version this Studio is; written into every saved envelope. */
export const STUDIO_ENGINE_VERSION = '0.15.1'

export const HOSTED_COPY = {
  conflict:
    'Someone saved a newer version. Reload to see it, or keep editing and save as a new version.',
  conflictAction: 'Save as new version',
  savedVersion: 'Version saved.',
  draftRestored: (time: string) => `Restored your unsaved draft from ${time}.`,
  sessionExpired: 'Your session with the Studio expired. Reload the page to continue.',
  loadFailed: (message: string) => `The template could not be opened: ${message}`,
  fontsMissing: (count: number) =>
    count === 1 ? '1 brand font could not be loaded.' : `${count} brand fonts could not be loaded.`,
  noBrandMedia: 'This workspace has no logo or photos in its brand kit yet.'
} as const

export type HostedSessionStatus =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'saving'; saveKind: 'draft' | 'version' }
  | { kind: 'conflict'; serverVersion: number | null }
  | { kind: 'error'; message: string }

export interface HostedSession {
  readonly config: HostedConfig
  readonly api: StudioAPI
  readonly status: Ref<HostedSessionStatus>
  readonly payload: Ref<StudioTemplatePayload | null>
  readonly version: Ref<number>
  readonly dirty: ComputedRef<boolean>
  readonly slots: ComputedRef<SlotReport>
  readonly fontReport: Ref<HostedFontReport | null>
  readonly brandReport: Ref<BrandLibraryReport | null>
  readonly aiEnabled: ComputedRef<boolean>
  /** Load the template into the store; resolves when the canvas shows it. */
  load(): Promise<void>
  /** File → Save / ⌘S / `host:save-version`. */
  saveVersion(): Promise<boolean>
  /** Autosave target; also runs on `pagehide`. */
  saveDraft(): Promise<boolean>
  /** Bring one slot's node into view. */
  focusNode(nodeId: string): void
  dispose(): void
}

/** Runs the autosave tick on a cadence; tests inject a manual scheduler. */
export interface AutosaveScheduler {
  /** Start calling `tick` every `AUTOSAVE_INTERVAL_MS`; returns the stop function. */
  start(tick: () => void): () => void
}

const vueuseAutosaveScheduler: AutosaveScheduler = {
  start(tick) {
    const { pause } = useIntervalFn(tick, AUTOSAVE_INTERVAL_MS, { immediate: true })
    return pause
  }
}

export interface HostedSessionOptions {
  config: HostedConfig
  store: EditorStore
  api?: StudioAPI
  bridge?: HostBridge
  /** Injected autosave cadence for tests. */
  autosave?: AutosaveScheduler
  /** Skip the brand-media fetches (unit tests). */
  skipBrandLibrary?: boolean
  skipFonts?: boolean
}

export function createHostedSession(options: HostedSessionOptions): HostedSession {
  const { config, store } = options
  const api =
    options.api ??
    createStudioAPI({
      apiOrigin: config.apiOrigin,
      templateId: config.templateId,
      token: () => hostedToken.value
    })
  const bridge = options.bridge ?? createHostBridge(config.apiOrigin)
  const autosave = options.autosave ?? vueuseAutosaveScheduler

  const status = shallowRef<HostedSessionStatus>({ kind: 'loading' })
  const payload = shallowRef<StudioTemplatePayload | null>(null)
  const version = shallowRef(0)
  const fontReport = shallowRef<HostedFontReport | null>(null)
  const brandReport = shallowRef<BrandLibraryReport | null>(null)
  const graphTick = shallowRef(0)
  const dirty = computed(() => store.hasUnsavedChanges())
  const aiEnabled = computed(() => payload.value?.ai.enabled ?? false)
  const slots = computed(() => {
    void graphTick.value
    return slotReport(store.graph, payload.value?.requiredSlots ?? [], store.state.currentPageId)
  })

  const disposers: Array<() => void> = []
  let saving: Promise<boolean> | null = null
  let stopAutosave: (() => void) | null = null
  let disposed = false

  // The Slots panel re-reads the graph on structural + name changes only.
  for (const event of ['node:created', 'node:updated', 'node:deleted', 'graph:replaced'] as const) {
    disposers.push(
      store.onEditorEvent(event, () => {
        graphTick.value++
      })
    )
  }

  disposers.push(
    watch(dirty, (value) => bridge.post({ type: 'studio:dirty', dirty: value }), { flush: 'sync' })
  )

  disposers.push(
    bridge.onMessage((message) => {
      switch (message.type) {
        case 'host:token':
          hostedToken.value = message.token
          if (status.value.kind === 'error') status.value = { kind: 'ready' }
          return
        case 'host:save-version':
          void saveVersion()
          return
        case 'host:request-close':
          if (dirty.value) bridge.post({ type: 'studio:close-blocked', dirty: true })
          else bridge.post({ type: 'studio:close-ok' })
      }
    })
  )

  function fail(message: string): void {
    status.value = { kind: 'error', message }
    bridge.post({ type: 'studio:error', message })
  }

  function markSaved(): void {
    // `setDocumentSource` with a non-fig format keeps no file handle / path and
    // resets the change tracker — the one upstream entry point that says
    // "this document is saved" without going through `.fig`.
    store.setDocumentSource(store.state.documentName, 'ci-hosted')
  }

  async function load(): Promise<void> {
    scrubTokenFromLocation()
    status.value = { kind: 'loading' }
    let data: StudioTemplatePayload
    try {
      data = await api.loadTemplate()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      fail(HOSTED_COPY.loadFailed(message))
      toast.error(HOSTED_COPY.loadFailed(message))
      throw error
    }
    payload.value = data
    version.value = data.version
    store.state.documentName = data.name

    const load = store.preparationController.begin({ kind: 'storage-open', subject: data.name })
    try {
      load.update({ phase: 'reading', detail: data.name })
      if (!options.skipFonts) {
        fontReport.value = await installHostedFonts(api, data.fonts, {
          arabicFamily: data.brand?.fontArabicFamily ?? null,
          signal: load.signal
        })
        if (fontReport.value.failed.length > 0)
          toast.warning(HOSTED_COPY.fontsMissing(fontReport.value.failed.length))
      }
      load.signal.throwIfAborted()

      const source = data.draft?.document ?? data.document
      const graph = deserializeGraph(source)
      load.update({ phase: 'decoding', detail: data.name })
      await applyImportedDocument(store, graph, load)
      load.signal.throwIfAborted()
      resolveBrandStrings(store.graph, (id, changes) => store.updateNode(id, changes))
      // A restored draft is what the person sees but not yet a version: leave the
      // change tracker dirty so the next autosave / Save version persists it.
      if (!data.draft) markSaved()
      // Same tail as the upstream `.fig` open path: fit, then ask for a frame.
      await store.fitCurrentPageToViewport()
      load.update({ phase: 'preparing-render', detail: data.name })
      store.requestRender()
      load.complete()
    } catch (error) {
      if (!load.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error)
        load.fail({ code: 'read-failed', message, retryable: false })
        fail(HOSTED_COPY.loadFailed(message))
        toast.error(HOSTED_COPY.loadFailed(message))
      }
      throw error
    }

    if (data.draft) toast.info(HOSTED_COPY.draftRestored(formatTime(data.draft.savedAt)))

    status.value = { kind: 'ready' }
    bridge.post({ type: 'studio:ready', templateId: config.templateId, version: version.value })

    if (data.brand && !options.skipBrandLibrary) {
      void installBrandLibrary(store, api, data.brand, config.workspaceSlug)
        .then((report) => {
          brandReport.value = report
          return report
        })
        .catch((error: unknown) => {
          console.warn('[CI Studio] brand library failed', error)
        })
    }

    stopAutosave = autosave.start(() => {
      if (dirty.value && !saving && status.value.kind === 'ready') void saveDraft()
    })
  }

  async function save(kind: 'draft' | 'version', baseVersion = version.value): Promise<boolean> {
    if (saving) return saving
    if (status.value.kind === 'loading' || status.value.kind === 'error') return false
    const previous = status.value
    status.value = { kind: 'saving', saveKind: kind }
    const sceneVersionAtCapture = store.state.sceneVersion
    saving = (async () => {
      try {
        const document = serializeGraph(store.graph, STUDIO_ENGINE_VERSION)
        const response = await api.saveTemplate({
          document,
          baseVersion,
          kind,
          name: store.state.documentName
        })
        version.value = response.version
        if (store.state.sceneVersion === sceneVersionAtCapture) markSaved()
        status.value = { kind: 'ready' }
        bridge.post({ type: 'studio:saved', version: response.version, kind })
        if (kind === 'version') toast.info(HOSTED_COPY.savedVersion)
        return true
      } catch (error) {
        if (error instanceof StudioConflictError) {
          status.value = { kind: 'conflict', serverVersion: error.currentVersion }
          const serverVersion = error.currentVersion
          toast.error(HOSTED_COPY.conflict, {
            label: HOSTED_COPY.conflictAction,
            run: () => {
              void save('version', serverVersion ?? version.value)
            }
          })
          return false
        }
        if (error instanceof StudioUnauthorizedError) {
          bridge.post({ type: 'studio:token-expiring' })
          status.value = previous.kind === 'conflict' ? previous : { kind: 'ready' }
          toast.error(HOSTED_COPY.sessionExpired)
          return false
        }
        const message = error instanceof Error ? error.message : String(error)
        status.value = previous.kind === 'conflict' ? previous : { kind: 'ready' }
        bridge.post({ type: 'studio:error', message })
        if (kind === 'version') toast.error(message)
        return false
      } finally {
        saving = null
      }
    })()
    return saving
  }

  function saveVersion(): Promise<boolean> {
    if (status.value.kind === 'conflict') {
      // Explicit Save after a conflict = "save as a new version" on top of the server.
      return save('version', status.value.serverVersion ?? version.value)
    }
    return save('version')
  }

  function saveDraft(): Promise<boolean> {
    if (status.value.kind === 'conflict') return Promise.resolve(false)
    return save('draft')
  }

  function focusNode(nodeId: string): void {
    if (!store.graph.getNode(nodeId)) return
    store.select([nodeId])
    store.zoomToSelection()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    stopAutosave?.()
    for (const stop of disposers) stop()
  }

  return {
    config,
    api,
    status,
    payload,
    version,
    dirty,
    slots,
    fontReport,
    brandReport,
    aiEnabled,
    load,
    saveVersion,
    saveDraft,
    focusNode,
    dispose
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
