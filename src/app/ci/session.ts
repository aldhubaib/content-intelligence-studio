// CI: the hosted editing session (ADR-058 §8, Track E3c Part B; Track E3d-a
// binding model v3 + native chrome — FB-44 / FB-45).
//
// One template, one tab, one API. The session loads the document into the
// Studio's first tab, migrates legacy `slot:` names to model v3 (marking the
// document dirty so the next save writes them back), keeps the app informed
// over the host bridge, autosaves a draft every 30 s while the document is
// dirty, and turns the File → Save command (⌘S) into "Save version". The File
// menu's Back / Save as new template / Open in new tab and the title bar's
// inline rename live here too (FB-45). Nothing here touches `.fig`: the wire
// format is the app's `openpencil-scene-graph` JSON, end to end.

import { useIntervalFn } from '@vueuse/core'
import { computed, shallowRef, watch, type ComputedRef, type Ref } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

import { replaceAIModelSettings } from '@/app/ai/models/store'
import { requestDocumentClose } from '@/app/document/close/prompt'
import { applyImportedDocument } from '@/app/document/io/imported-document'
import type { EditorStore } from '@/app/editor/session'
import { toast } from '@/app/shell/ui'

import { hostedAIModelSettings, setHostedAIConfig } from './ai'
import {
  StudioConflictError,
  StudioUnauthorizedError,
  createStudioAPI,
  type StudioAPI,
  type StudioTemplatePayload
} from './api'
import {
  bindingsReport,
  DEFAULT_VOCABULARY,
  migrateLegacyBindings,
  type BindingsReport
} from './bindings'
import { installBrandLibrary, previewBrandBindings, type BrandLibraryReport } from './brand-library'
import { deserializeGraph, serializeGraph } from './document'
import { installHostedFonts, type HostedFontReport } from './fonts'
import { hostedToken, scrubTokenFromLocation, type HostedConfig } from './hosted'
import { createHostBridge, type HostBridge, type StudioNavigateTarget } from './protocol'

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
  noBrandMedia: 'This workspace has no user images or logos in its brand kit yet.',
  migrated: (count: number) =>
    count === 1
      ? '1 layer was renamed to the new content: name. Save a version to keep it.'
      : `${count} layers were renamed to the new content: names. Save a version to keep them.`,
  renameFailed: (message: string) => `The template could not be renamed: ${message}`,
  duplicated: (name: string) => `Saved as “${name}”. Opening it…`,
  duplicateFailed: (message: string) => `Save as new template failed: ${message}`
} as const

/** Rename debounce: the title bar commits on blur / Enter, the API is asked once the name settles. */
export const RENAME_DEBOUNCE_MS = 400

/** FB-42: a template still named "Draft" / "Draft 2" shows the Draft mark next to its title. */
export function isDraftName(name: string): boolean {
  return /^draft(\s+\d+)?$/i.test(name.trim())
}

export type HostedSaveState =
  | { kind: 'loading' }
  | { kind: 'saved'; version: number }
  | { kind: 'unsaved' }
  | { kind: 'saving' }
  | { kind: 'conflict' }
  | { kind: 'error'; message: string }

/** The title bar's save word (FB-45): "Saved · v2" / "Unsaved changes" / "Saving…". */
export function saveStateWords(state: HostedSaveState): string {
  switch (state.kind) {
    case 'loading':
      return 'Opening…'
    case 'saved':
      return `Saved · v${state.version}`
    case 'unsaved':
      return 'Unsaved changes'
    case 'saving':
      return 'Saving…'
    case 'conflict':
      return 'Newer version on the server'
    default:
      return state.message
  }
}

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
  /** Live Bindings report over the graph (FB-44 §3). */
  readonly bindings: ComputedRef<BindingsReport>
  /** Bumps on every structural / name change of the graph — panels re-read on it. */
  readonly graphTick: Ref<number>
  readonly saveState: ComputedRef<HostedSaveState>
  readonly fontReport: Ref<HostedFontReport | null>
  readonly brandReport: Ref<BrandLibraryReport | null>
  readonly aiEnabled: ComputedRef<boolean>
  /** Load the template into the store; resolves when the canvas shows it. */
  load(): Promise<void>
  /** File → Save version / ⌘S. */
  saveVersion(): Promise<boolean>
  /** Autosave target; also runs on `pagehide`. */
  saveDraft(): Promise<boolean>
  /** File → Save as new template: the current document as a NEW template, then open it. */
  saveAsNewTemplate(): Promise<boolean>
  /** File → Back to templates: the upstream unsaved-changes prompt, then leave. */
  backToTemplates(): Promise<boolean>
  /** File → Open in new tab. */
  openInNewTab(): void
  /** Bring one node into view. */
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
  /** Receives the payload's `ai` block; defaults to pinning the AI panel's provider + models (Part F). */
  applyAI?: (ai: StudioTemplatePayload['ai']) => void
  /** Receives the window title; defaults to `document.title` (Part F). */
  setTitle?: (title: string) => void
}

/** Window title in hosted mode: the template name, then the product. */
export function hostedWindowTitle(templateName: string): string {
  const name = templateName.trim()
  return name ? `${name} · Content Intelligence Studio` : 'Content Intelligence Studio'
}

function setDocumentTitle(title: string): void {
  if (typeof document === 'undefined') return
  document.title = title
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
  const setTitle = options.setTitle ?? setDocumentTitle
  const setWindowTitle = (templateName: string) => setTitle(hostedWindowTitle(templateName))
  const applyAI =
    options.applyAI ??
    ((ai: StudioTemplatePayload['ai']) => {
      const models = ai.enabled ? (ai.models ?? []) : []
      setHostedAIConfig({ enabled: ai.enabled, models })
      replaceAIModelSettings(hostedAIModelSettings(config.apiOrigin, models))
    })

  const status = shallowRef<HostedSessionStatus>({ kind: 'loading' })
  const payload = shallowRef<StudioTemplatePayload | null>(null)
  const version = shallowRef(0)
  const fontReport = shallowRef<HostedFontReport | null>(null)
  const brandReport = shallowRef<BrandLibraryReport | null>(null)
  const graphTick = shallowRef(0)
  const dirty = computed(() => store.hasUnsavedChanges())
  const aiEnabled = computed(() => payload.value?.ai.enabled ?? false)
  const vocabulary = computed(() => payload.value?.bindings.vocabulary ?? DEFAULT_VOCABULARY)
  const bindings = computed(() => {
    void graphTick.value
    return bindingsReport(
      store.graph,
      vocabulary.value,
      payload.value?.format ?? null,
      store.state.currentPageId
    )
  })
  const saveState = computed<HostedSaveState>(() => {
    const s = status.value
    if (s.kind === 'loading') return { kind: 'loading' }
    if (s.kind === 'error') return { kind: 'error', message: s.message }
    if (s.kind === 'saving') return { kind: 'saving' }
    if (s.kind === 'conflict') return { kind: 'conflict' }
    return dirty.value ? { kind: 'unsaved' } : { kind: 'saved', version: version.value }
  })

  const disposers: Array<() => void> = []
  let saving: Promise<boolean> | null = null
  let stopAutosave: (() => void) | null = null
  let disposed = false

  // The Bindings panel re-reads the graph on structural + name changes only.
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
  // Inline rename in the title bar (FB-42 / FB-45): the window title follows at once,
  // the app's `renameTemplate` is asked once the name settles.
  let renameTimer: ReturnType<typeof setTimeout> | null = null
  let lastSentName: string | null = null
  disposers.push(
    watch(
      () => store.state.documentName,
      (name) => {
        if (status.value.kind === 'loading') return
        setWindowTitle(name)
        const trimmed = name.trim()
        if (!trimmed || trimmed === lastSentName) return
        if (renameTimer) clearTimeout(renameTimer)
        renameTimer = setTimeout(() => {
          renameTimer = null
          void rename(trimmed)
        }, RENAME_DEBOUNCE_MS)
      }
    )
  )

  disposers.push(
    bridge.onMessage((message) => {
      // The only host message left (FB-45): a rotated token.
      hostedToken.value = message.token
      if (status.value.kind === 'error') status.value = { kind: 'ready' }
    })
  )

  async function rename(name: string): Promise<void> {
    if (name === lastSentName) return
    try {
      const result = await api.renameTemplate(name)
      lastSentName = result.name
      if (result.name !== store.state.documentName) store.state.documentName = result.name
      bridge.post({ type: 'studio:renamed', name: result.name })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(HOSTED_COPY.renameFailed(message))
    }
  }

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
    lastSentName = data.name
    store.state.documentName = data.name
    setWindowTitle(data.name)
    applyAI({ enabled: data.ai.enabled, models: data.ai.models ?? [] })

    const load = store.preparationController.begin({ kind: 'storage-open', subject: data.name })
    try {
      load.update({ phase: 'reading', detail: data.name })
      if (!options.skipFonts) {
        // FB-44 §4: typography is the template's own — the Arabic fallback is the
        // first Arabic family in the catalog, else the engine's bundled face.
        fontReport.value = await installHostedFonts(api, data.fonts, {
          arabicFamily: data.fonts.find((f) => /arabic/i.test(f.family))?.family ?? null,
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
      // A restored draft is what the person sees but not yet a version: leave the
      // change tracker dirty so the next autosave / Save version persists it.
      if (!data.draft) markSaved()
      // Model v3 on load (FB-44 §2): legacy `slot:` names become `content:` names and
      // an unnamed first artboard becomes `cover`. Through the store, so the document
      // is dirty and the next save writes the names back.
      const migration = migrateLegacyBindings(
        store.graph,
        (id, changes) => store.updateNode(id, changes),
        vocabulary.value,
        store.state.currentPageId
      )
      if (migration.renamedLayers > 0) toast.info(HOSTED_COPY.migrated(migration.renamedLayers))
      // Fit the frame to the viewport on open (E3c.1 Part B), the way the demo does
      // it (`src/app/demo/document.ts`): the engine only knows the real canvas size
      // once the surface exists, so wait for `canvasReady`, fit once, ask for a
      // frame and hold `ready` until that frame has been presented. Viewport state
      // is not content — nothing here reaches the saved payload.
      await store.canvasReady
      load.signal.throwIfAborted()
      store.zoomToFit()
      load.update({ phase: 'preparing-render', detail: data.name })
      store.requestRender()
      await waitForFirstFrame(load.id)
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
    // FB-45: focus lands in the Studio so ⌘S / shortcuts work without a click.
    focusCanvas()
    bridge.post({
      type: 'studio:ready',
      templateId: config.templateId,
      version: version.value,
      // CI: Track E4 — the host shows its one-time "Proposed by AI" banner from this flag.
      ...(data.proposal ? { proposal: true } : {})
    })

    if (data.brand && !options.skipBrandLibrary) {
      const brand = data.brand
      void installBrandLibrary(store, api, brand, config.workspaceSlug, {
        onLoaded: (loaded) => {
          // A `brand:<kind>[:<name>]` layer opens with its asset painted in (FB-44 §5).
          // A preview is not an edit: a clean document stays "Saved".
          const wasDirty = dirty.value
          const preview = previewBrandBindings(store, loaded, vocabulary.value)
          if (preview.painted.length > 0 && !wasDirty) markSaved()
          if (preview.painted.length > 0) store.requestRender()
        }
      })
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

  /**
   * Resolve once the canvas has presented the loaded scene. A background tab
   * gets no animation frames, so the presentation wait can time out — that is
   * not a failed load: log it and let the session become ready anyway.
   */
  async function waitForFirstFrame(loadId: number): Promise<void> {
    try {
      await store.preparationController.waitForPresentation(loadId, store.state.sceneVersion)
    } catch (error) {
      console.warn('[CI Studio] first frame not presented yet, continuing', error)
    }
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

  async function saveAsNewTemplate(): Promise<boolean> {
    if (status.value.kind === 'loading' || status.value.kind === 'error') return false
    try {
      const document = serializeGraph(store.graph, STUDIO_ENGINE_VERSION)
      const result = await api.duplicateTemplate({
        document,
        name: `${store.state.documentName} copy`
      })
      toast.info(HOSTED_COPY.duplicated(result.name))
      navigate({ to: 'template', templateId: result.templateId })
      return true
    } catch (error) {
      if (error instanceof StudioUnauthorizedError) {
        bridge.post({ type: 'studio:token-expiring' })
        toast.error(HOSTED_COPY.sessionExpired)
        return false
      }
      const message = error instanceof Error ? error.message : String(error)
      toast.error(HOSTED_COPY.duplicateFailed(message))
      return false
    }
  }

  async function backToTemplates(): Promise<boolean> {
    // The upstream unsaved-changes prompt (Save / Don't save / Cancel); "Save" is
    // routed to Save version through the hosted save override.
    const choice = await requestDocumentClose(store, store.state.documentName)
    if (choice === 'cancel') return false
    if (choice !== 'discard' && dirty.value) return false
    navigate({ to: 'templates' })
    return true
  }

  function openInNewTab(): void {
    navigate({ to: 'new-tab' })
  }

  /** App URL for a navigation target — used when the Studio runs outside the host frame. */
  function appURLFor(target: StudioNavigateTarget): string | null {
    const base = `${config.apiOrigin}/w/${encodeURIComponent(config.workspaceSlug)}/templates`
    switch (target.to) {
      case 'templates':
        return base
      case 'template':
        return `${base}/${encodeURIComponent(target.templateId)}/edit`
      default:
        return null
    }
  }

  function navigate(target: StudioNavigateTarget): void {
    if (bridge.framed) {
      bridge.post({ type: 'studio:navigate', ...target })
      return
    }
    // Opened in its own tab (File → Open in new tab): no host to ask — go to the app.
    if (!IS_BROWSER) return
    const url = appURLFor(target)
    if (url) window.location.assign(url)
    else window.open(window.location.href, '_blank', 'noopener')
  }

  function focusCanvas(): void {
    if (typeof document === 'undefined') return
    const canvas = document.querySelector<HTMLElement>('[data-test-id="canvas-element"]')
    canvas?.focus({ preventScroll: true })
  }

  function focusNode(nodeId: string): void {
    if (!store.graph.getNode(nodeId)) return
    store.select([nodeId])
    store.zoomToSelection()
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    if (renameTimer) clearTimeout(renameTimer)
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
    bindings,
    graphTick,
    saveState,
    fontReport,
    brandReport,
    aiEnabled,
    load,
    saveVersion,
    saveDraft,
    saveAsNewTemplate,
    backToTemplates,
    openInNewTab,
    focusNode,
    dispose
  }
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}
