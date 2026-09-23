// CI: typed client for the Content Intelligence Studio API (Track E3c Part B / C,
// Track E3d-a binding model v3 — FB-44 / FB-45).
//
// One template per session. Every call carries `Authorization: Bearer <token>`
// and is bound to the configured app origin; a URL on another origin is
// refused before any request leaves the page (the nginx CSP would block it
// anyway — this gives the person a sentence instead of a console error).

import type { SerializedDocument } from './document'

/** One design format of the app's catalog (`src/lib/design-formats.ts` there). */
export interface StudioFormat {
  /** `instagram_post`, `linkedin_wide`, … */
  id: string
  /** "Instagram post" */
  label: string
  platform: string
  width: number
  height: number
  /** "4:5" */
  aspect: string
  /** Safe-area inset in percent of the frame: [top, right, bottom, left]. */
  safeInsetPct: readonly [number, number, number, number]
  /** Carousel slide limit on the platform; 1 = single image only. */
  slideCap: number
}

/** The closed binding vocabulary the app hands over (one source: `src/lib/bindings-vocabulary.ts` there). */
export interface StudioBindingsVocabulary {
  /** `title`, `subtitle`, `body`, `cta`, `article-url` */
  contentText: string[]
  /** `image` */
  contentImage: string[]
  /** `ai-image` — a valid binding with no writer yet. */
  reserved: string[]
  /** `user-image`, `company-logo-light`, `company-logo-dark` */
  brandKinds: string[]
  /** `cover`, `repeat`, `ending` */
  roles: string[]
  /** Legacy `slot:<name>` → v3 slot (`headline` → `title`, `cover` → `image`, …). */
  legacy: Record<string, string>
}

export type StudioRoleName = 'cover' | 'repeat' | 'ending'

export interface StudioBindingsReason {
  code: string
  words: string
  name?: string
  count?: number
}

export interface StudioBindingsRole {
  role: StudioRoleName
  present: boolean
  frameId: string | null
  status: 'ok' | 'missing'
  bindings: string[]
  reasons: StudioBindingsReason[]
  /** "Cover · OK" / "Repeat · repeat has no content:body" / "Ending · not added" */
  words: string
}

/** The app's Bindings report of the CURRENT version — the Studio recomputes its own over the live graph. */
export interface StudioBindingsReport {
  version: string
  roles: StudioBindingsRole[]
  strayBindings: string[]
  usable: { single: boolean; carousel: boolean }
  statusWords: string
  migrated: boolean
}

export interface StudioBindingsPayload {
  vocabulary: StudioBindingsVocabulary
  report: StudioBindingsReport
}

/** GET /api/studio/templates/{id} */
export interface StudioTemplatePayload {
  document: SerializedDocument
  name: string
  /** Monotonic template version the document was read at; sent back as `baseVersion`. */
  version: number
  updatedAt: string
  /** The ONE format this template is drawn for (FB-44 §1). */
  format: StudioFormat
  /** The whole catalog — the **Content formats** frame presets. */
  formats: StudioFormat[]
  collection: string | null
  brand: StudioBrand | null
  fonts: StudioFont[]
  bindings: StudioBindingsPayload
  /** AI panel switch for the workspace + the models the proxy offers (Part F); `models` is empty when disabled. */
  ai: { enabled: boolean; models?: Array<{ id: string; label: string }> }
  /** Present when the app holds an autosaved draft newer than `version`. */
  draft?: { document: SerializedDocument; savedAt: string } | null
  /** Track E4 (ADR-061 §4): true while this template is an AI proposal no person has saved yet. */
  proposal?: boolean
  /**
   * Track E3d-b1 (FB-44 §6): where the content **Preview with ▾** menu asks for
   * the workspace's Approved Arabic candidates, and the **Sample text** words.
   * Absent on an older app → the menu says "Preview unavailable".
   */
  preview?: StudioPreviewPayload | null
}

export interface StudioPreviewPayload {
  /** `GET` (bearer, app origin) → `{ candidates: StudioPreviewCandidate[] }`. */
  candidatesUrl: string
  sampleText: StudioPreviewContent
}

/** The five `content:*` text values a preview fills — one candidate, or the sample. */
export interface StudioPreviewContent {
  title: string
  subtitle: string
  body: string
  cta: string
  articleUrl: string
}

export interface StudioPreviewCandidate extends StudioPreviewContent {
  id: string
  /** The request's format (`LINKEDIN_POST`, …) or null for an item candidate. */
  format: string | null
  /** "LinkedIn Post" — the menu's format Tag; null with `format`. */
  formatLabel: string | null
  approvedAt: string
  /** Bearer-gated image on the app origin for `content:image`, or null → the layer's placeholder stays. */
  imageUrl: string | null
}

/** The three galleries as the layers name them: `brand:<kind>[:<asset name>]` (FB-44 §5). */
export type StudioBrandAssetKind = 'user-image' | 'company-logo-light' | 'company-logo-dark'

export interface StudioBrandAsset {
  /** Row id — the `…/assets/<id>` URL segment and the library component key. */
  id: string
  name: string
  /** Absolute URL on the app origin (proxied media) — fetched with the bearer. */
  url: string
  kind: StudioBrandAssetKind
  /** The gallery's default: what a `brand:<kind>` layer without a name resolves to. */
  isDefault: boolean
  contentType: string
}

export interface StudioBrand {
  workspaceName: string
  /** TWO colours (FB-44 §4) — the `Brand` variables collection inside the document mirrors them. */
  colors: Record<'primary' | 'secondary', string>
  assets: StudioBrandAsset[]
}

export interface StudioFont {
  family: string
  weight: number
  style: 'normal' | 'italic'
  /** Absolute URL on the app origin (`/api/studio/templates/…/fonts/<face>.ttf`). */
  url: string
}

/** PUT /api/studio/templates/{id} — the two document saves. */
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

/** PUT `{ kind: "duplicate" }` — **Save as new template** (FB-45): the same document as a NEW template of the same format and collection. */
export interface StudioDuplicateResponse {
  templateId: string
  name: string
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
  /** Inline rename in the title bar → `renameTemplate` on the app (FB-45); no version is written. */
  renameTemplate(name: string, signal?: AbortSignal): Promise<{ name: string }>
  /** File › Save as new template (FB-45). */
  duplicateTemplate(
    body: { document: SerializedDocument; name?: string },
    signal?: AbortSignal
  ): Promise<StudioDuplicateResponse>
  /** Fetch bytes (fonts, brand media) from a URL on the app origin with the bearer. */
  fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array>
  /** Fetch JSON from a URL on the app origin with the bearer (the preview candidates list). */
  fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T>
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

  async function put<T>(body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await request(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    })
    if (!response.ok) throw await readError(response)
    return (await response.json()) as T
  }

  return {
    apiOrigin: options.apiOrigin,
    async loadTemplate(signal) {
      const response = await request(base, { method: 'GET', signal })
      if (!response.ok) throw await readError(response)
      return (await response.json()) as StudioTemplatePayload
    },
    saveTemplate(body, signal) {
      return put<StudioSaveResponse>(body, signal)
    },
    renameTemplate(name, signal) {
      return put<{ name: string }>({ kind: 'rename', name }, signal)
    },
    duplicateTemplate(body, signal) {
      return put<StudioDuplicateResponse>({ kind: 'duplicate', ...body }, signal)
    },
    async fetchBytes(url, signal) {
      const response = await request(url, { method: 'GET', headers: { Accept: '*/*' }, signal })
      if (!response.ok) throw await readError(response)
      return new Uint8Array(await response.arrayBuffer())
    },
    async fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
      const response = await request(url, { method: 'GET', signal })
      if (!response.ok) throw await readError(response)
      return (await response.json()) as T
    },
    aiChatURL() {
      return `${options.apiOrigin}/api/studio/ai/chat`
    }
  }
}
