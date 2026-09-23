// CI: Preview with real content — the Approved-candidates list (Track E3d-b1, FB-44 §6).
//
// The list behind **Preview with ▾**: fetched from the app with the live bearer
// the first time the menu opens, cached for the session, re-asked by **Refresh**.
// `unavailable` covers a 404 (an app without the route), a network error, an
// expired token and a payload without a `preview` block — the menu says
// "Preview unavailable" and a later Refresh asks again.

import { shallowRef, type Ref } from 'vue'

import type { EditorStore } from '@/app/editor/session'

import {
  StudioUnauthorizedError,
  type StudioAPI,
  type StudioBindingsVocabulary,
  type StudioPreviewCandidate,
  type StudioTemplatePayload
} from './api'
import { preselectedCandidate } from './preview'
import { createPreviewOverlay, type PreviewOverlay } from './preview-overlay'

export type PreviewCandidatesState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; candidates: StudioPreviewCandidate[]; loadedAt: string }
  | { kind: 'unavailable' }

export interface PreviewCandidatesOptions {
  /** The payload's `preview.candidatesUrl`; null when the app sent no preview block. */
  url: () => string | null
  /** Told when the bearer was refused so the host can rotate it. */
  onUnauthorized: () => void
  now?: () => Date
}

export interface PreviewCandidates {
  readonly state: Ref<PreviewCandidatesState>
  /** Fetch (or re-fetch with `force`) — never throws; a failure is the `unavailable` state. */
  load(force?: boolean): Promise<StudioPreviewCandidate[]>
}

export function createPreviewCandidates(api: StudioAPI, options: PreviewCandidatesOptions): PreviewCandidates {
  const state = shallowRef<PreviewCandidatesState>({ kind: 'idle' })
  const now = options.now ?? (() => new Date())
  let inFlight: Promise<StudioPreviewCandidate[]> | null = null

  async function fetchList(url: string): Promise<StudioPreviewCandidate[]> {
    try {
      const body = await api.fetchJSON<{ candidates?: StudioPreviewCandidate[] }>(url)
      const candidates = Array.isArray(body.candidates) ? body.candidates : []
      state.value = { kind: 'ready', candidates, loadedAt: now().toISOString() }
      return candidates
    } catch (error: unknown) {
      if (error instanceof StudioUnauthorizedError) options.onUnauthorized()
      state.value = { kind: 'unavailable' }
      return []
    } finally {
      inFlight = null
    }
  }

  function load(force = false): Promise<StudioPreviewCandidate[]> {
    const current = state.value
    if (!force && current.kind === 'ready') return Promise.resolve(current.candidates)
    if (inFlight) return inFlight
    const url = options.url()
    if (!url) {
      state.value = { kind: 'unavailable' }
      return Promise.resolve([])
    }
    state.value = { kind: 'loading' }
    inFlight = fetchList(url)
    return inFlight
  }

  return { state, load }
}

export interface SessionPreviewOptions {
  vocabulary: () => StudioBindingsVocabulary
  payload: () => StudioTemplatePayload | null
  onUnauthorized: () => void
}

/** The whole preview lane of a hosted session: overlay + candidates + `?preview=` preselect. */
export interface SessionPreview {
  readonly overlay: PreviewOverlay
  readonly candidates: PreviewCandidates
  /** Start at None (every open), then preselect `?preview=<id>` once the list is in. */
  open(previewCandidateId: string | null | undefined): void
  dispose(): void
}

export function createSessionPreview(
  store: EditorStore,
  api: StudioAPI,
  options: SessionPreviewOptions
): SessionPreview {
  const overlay = createPreviewOverlay(store, {
    vocabulary: options.vocabulary,
    sampleText: () => options.payload()?.preview?.sampleText ?? null,
    loadImage: (url) => api.fetchBytes(url)
  })
  const candidates = createPreviewCandidates(api, {
    url: () => options.payload()?.preview?.candidatesUrl ?? null,
    onUnauthorized: options.onUnauthorized
  })
  let disposed = false

  async function preselect(candidateId: string): Promise<void> {
    const wanted = preselectedCandidate(await candidates.load(), candidateId)
    if (wanted && !disposed) overlay.setContent({ kind: 'candidate', candidate: wanted })
  }

  return {
    overlay,
    candidates,
    open(previewCandidateId) {
      overlay.setContent({ kind: 'none' })
      if (previewCandidateId) void preselect(previewCandidateId)
    },
    dispose() {
      disposed = true
      overlay.dispose()
    }
  }
}
