// CI: typed client for the Content Intelligence Studio API (Track E3c Part B / C).
//
// One template per session. Every call carries `Authorization: Bearer <token>`
// and is bound to the configured app origin; a URL on another origin is
// refused before any request leaves the page (the nginx CSP would block it
// anyway — this gives the person a sentence instead of a console error).

import type { SerializedDocument } from './document'

/** GET /api/studio/templates/{id} */
export interface StudioTemplatePayload {
  document: SerializedDocument
  name: string
  /** Monotonic template version the document was read at; sent back as `baseVersion`. */
  version: number
  updatedAt: string
  brand: StudioBrand | null
  fonts: StudioFont[]
  /** Slots the bound formats require (`headline`, `cover`, …); a missing one is a warning in the Slots panel. */
  requiredSlots: string[]
  ai: { enabled: boolean }
  /** Present when the app holds an autosaved draft newer than `version`. */
  draft?: { document: SerializedDocument; savedAt: string } | null
}

export interface StudioBrandAsset {
  /** Stable key inside the library (`logo-light`, `logo-dark`, `photo:<id>`). */
  key: string
  name: string
  /** Absolute URL on the app origin (proxied media) — fetched with the bearer. */
  url: string
  kind: 'logo-light' | 'logo-dark' | 'photo'
}

export interface StudioBrand {
  workspaceName: string
  colors: Record<'primary' | 'secondary' | 'accent' | 'background' | 'text', string>
  fontArabicFamily: string
  fontLatinFamily: string
  watermarkText: string | null
  assets: StudioBrandAsset[]
}

export interface StudioFont {
  family: string
  weight: number
  style: 'normal' | 'italic'
  /** Absolute URL on the app origin (`/api/design-engine/brand-fonts/…`). */
  url: string
}

/** PUT /api/studio/templates/{id} */
export interface StudioSaveRequest {
  document: SerializedDocument
  baseVersion: number
  kind: 'draft' | 'version'
  name?: string
}

export interface StudioSaveResponse {
  version: number
  updatedAt: string
}

export class StudioAPIError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null = null
  ) {
    super(message)
    this.name = 'StudioAPIError'
  }
}

/** 409 on PUT — someone saved a newer version. */
export class StudioConflictError extends StudioAPIError {
  constructor(readonly currentVersion: number | null) {
    super('Someone saved a newer version.', 409, 'conflict')
    this.name = 'StudioConflictError'
  }
}

/** 401 — the bearer is no longer accepted; the host must mint a new one. */
export class StudioUnauthorizedError extends StudioAPIError {
  constructor() {
    super('Your session with the Studio expired.', 401, 'unauthorized')
    this.name = 'StudioUnauthorizedError'
  }
}

export interface StudioAPIOptions {
  apiOrigin: string
  templateId: string
  /** Read on every request so a rotated token is picked up without re-creating the client. */
  token: () => string
  fetch?: typeof fetch
}

export interface StudioAPI {
  loadTemplate(signal?: AbortSignal): Promise<StudioTemplatePayload>
  saveTemplate(body: StudioSaveRequest, signal?: AbortSignal): Promise<StudioSaveResponse>
  /** Fetch bytes (fonts, brand media) from a URL on the app origin with the bearer. */
  fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array>
  /** Absolute URL of the AI proxy the panel's provider posts to. */
  aiChatURL(): string
  readonly apiOrigin: string
}

// The engine's web-font manager swaps `globalThis.fetch` for a host-checked proxy
// while a provider operation is in flight; the app API must never go through it.
const NATIVE_FETCH: typeof fetch | null =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null

export function createStudioAPI(options: StudioAPIOptions): StudioAPI {
  const doFetch = options.fetch ?? NATIVE_FETCH ?? fetch
  const base = `${options.apiOrigin}/api/studio/templates/${encodeURIComponent(options.templateId)}`

  function assertOwnOrigin(url: string): URL {
    const parsed = new URL(url, options.apiOrigin)
    if (parsed.origin !== options.apiOrigin)
      throw new StudioAPIError(
        `Refused to fetch ${parsed.origin}: not the app origin.`,
        0,
        'origin'
      )
    return parsed
  }

  async function request(
    url: string,
    init: RequestInit & { signal?: AbortSignal }
  ): Promise<Response> {
    const target = assertOwnOrigin(url)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${options.token()}`)
    headers.set('Accept', 'application/json')
    const response = await doFetch(target, { ...init, headers, credentials: 'omit', mode: 'cors' })
    if (response.status === 401) throw new StudioUnauthorizedError()
    return response
  }

  async function readError(response: Response): Promise<StudioAPIError> {
    type ErrorBody = { error?: { code?: string; message?: string }; currentVersion?: number }
    let body: ErrorBody | null = null
    try {
      body = (await response.json()) as ErrorBody
    } catch {
      body = null
    }
    if (response.status === 409) return new StudioConflictError(body?.currentVersion ?? null)
    const message =
      body?.error?.message ??
      `The Studio API answered ${response.status} ${response.statusText}`.trim()
    return new StudioAPIError(message, response.status, body?.error?.code ?? null)
  }

  return {
    apiOrigin: options.apiOrigin,
    async loadTemplate(signal) {
      const response = await request(base, { method: 'GET', signal })
      if (!response.ok) throw await readError(response)
      return (await response.json()) as StudioTemplatePayload
    },
    async saveTemplate(body, signal) {
      const response = await request(base, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal
      })
      if (!response.ok) throw await readError(response)
      return (await response.json()) as StudioSaveResponse
    },
    async fetchBytes(url, signal) {
      const response = await request(url, { method: 'GET', headers: { Accept: '*/*' }, signal })
      if (!response.ok) throw await readError(response)
      return new Uint8Array(await response.arrayBuffer())
    },
    aiChatURL() {
      return `${options.apiOrigin}/api/studio/ai/chat`
    }
  }
}
