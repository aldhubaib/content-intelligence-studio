// CI: the render sidecar's wire contract (ADR-058 §8, Track E3c Part E).
//
//   POST /internal/render        Authorization: Bearer <STUDIO_INTERNAL_SECRET>
//     { document, frameId?, format: "png", scale, mode?, fonts: FontRef[], fontPolicy? }
//     200 image/png  + X-Render-Width / X-Render-Height / X-Render-Frame / X-Render-Engine / X-Render-Report
//     400 bad_request          the body is not a render request
//     401 unauthorized         missing / wrong bearer
//     413 payload_too_large    body above STUDIO_RENDER_MAX_BODY_MB
//     422 unsupported_document | frame_not_found | no_frame | fonts_not_ready
//     428 fonts_missing        { missing: [sha256…] } — resend with `data` for those hashes
//     503 not_configured       the sidecar has no secret
//     503 render_unavailable   the process is draining (recycle after STUDIO_RENDER_MAX_RENDERS
//                              renders, or the CanvasKit heap is exhausted and the process is
//                              about to exit); the caller retries later — INC-13
//     500 render_failed        the engine threw
//   GET  /internal/healthz     { ok, engine, canvasKit, configured, fontsCached }   (no bearer)
//   GET  /internal/health      Authorization: Bearer <STUDIO_INTERNAL_SECRET>
//                              { ok, engineVersion, renders, rssMb, heapMb, uptimeSec }
//
// Fonts are content-addressed: a `FontRef` names a face by sha256 of its
// bytes; the sidecar keeps the bytes in memory by that hash and answers 428
// for hashes it has not seen so the caller resends only those with `data`
// (base64). Nothing is ever fetched by URL — the sidecar has no outbound
// network path and no credential for the app.

export const RENDER_FORMATS = ['png'] as const
export type RenderFormat = (typeof RENDER_FORMATS)[number]

export const FONT_POLICIES = ['strict', 'warn'] as const
export type FontPolicy = (typeof FONT_POLICIES)[number]

export const RENDER_MODES = ['direct', 'supersample'] as const
export type RenderMode = (typeof RENDER_MODES)[number]

export interface FontRef {
  family: string
  weight: 400 | 700
  /** sha256 hex of the face bytes. */
  hash: string
  /** base64 bytes — only when the caller answers a 428. */
  data?: string
}

export interface RenderRequest {
  document: unknown
  frameId?: string
  format: RenderFormat
  scale: number
  mode?: RenderMode
  fonts: FontRef[]
  /** `strict` (default): a substituted / pending / exhausted text node is a 422. `warn`: render anyway, report in the header. */
  fontPolicy: FontPolicy
}

export type RenderErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'payload_too_large'
  | 'unsupported_document'
  | 'frame_not_found'
  | 'no_frame'
  | 'fonts_not_ready'
  | 'fonts_missing'
  | 'not_configured'
  | 'render_unavailable'
  | 'render_failed'

export interface RenderErrorBody {
  error: RenderErrorCode
  message: string
  missing?: string[]
  report?: unknown
}

// CI: INC-13 — the bearer-gated `GET /internal/health` body: process facts the app's operator reads.
export interface SidecarHealthBody {
  /** False while the process is draining (recycle or exhaustion) — a new render would get 503. */
  ok: boolean
  engineVersion: string
  /** Successful renders since the process started. */
  renders: number
  rssMb: number
  /** CanvasKit WASM heap size (grows only; a healthy process plateaus), or null before the first render. */
  heapMb: number | null
  uptimeSec: number
}

export const MAX_SCALE = 8
export const MIN_SCALE = 0.05
const SHA256_HEX = /^[0-9a-f]{64}$/

export type ParseResult = { ok: true; request: RenderRequest } | { ok: false; message: string }

/** The untrusted shape of a render body: every field present but unknown. */
interface RawRenderBody {
  document?: unknown
  frameId?: unknown
  format?: unknown
  scale?: unknown
  mode?: unknown
  fonts?: unknown
  fontPolicy?: unknown
}

interface RawFontRef {
  family?: unknown
  weight?: unknown
  hash?: unknown
  data?: unknown
}

function isObject(value: unknown): value is object {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isRawRenderBody(value: unknown): value is RawRenderBody {
  return isObject(value)
}

function isRawFontRef(value: unknown): value is RawFontRef {
  return isObject(value)
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

type Field<T> = { ok: true; value: T } | { ok: false; message: string }

function parseScale(raw: unknown): Field<number> {
  const scale = raw === undefined ? 1 : Number(raw)
  if (!Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) {
    return {
      ok: false,
      message: `\`scale\` must be a number between ${MIN_SCALE} and ${MAX_SCALE}.`
    }
  }
  return { ok: true, value: scale }
}

function parseFrameId(raw: unknown): Field<string | undefined> {
  if (raw === undefined) return { ok: true, value: undefined }
  if (typeof raw !== 'string' || !raw) {
    return { ok: false, message: '`frameId` must be a non-empty string when present.' }
  }
  return { ok: true, value: raw }
}

function parseFontRef(entry: unknown, index: number): Field<FontRef> {
  if (!isRawFontRef(entry)) return { ok: false, message: `fonts[${index}] must be an object.` }
  if (typeof entry.family !== 'string' || !entry.family.trim()) {
    return { ok: false, message: `fonts[${index}].family must be a non-empty string.` }
  }
  if (entry.weight !== 400 && entry.weight !== 700) {
    return { ok: false, message: `fonts[${index}].weight must be 400 or 700.` }
  }
  if (typeof entry.hash !== 'string' || !SHA256_HEX.test(entry.hash)) {
    return { ok: false, message: `fonts[${index}].hash must be a sha256 hex digest.` }
  }
  if (entry.data !== undefined && typeof entry.data !== 'string') {
    return { ok: false, message: `fonts[${index}].data must be a base64 string when present.` }
  }
  return {
    ok: true,
    value: { family: entry.family, weight: entry.weight, hash: entry.hash, data: entry.data }
  }
}

function parseFonts(raw: unknown): Field<FontRef[]> {
  const list = raw ?? []
  if (!Array.isArray(list)) return { ok: false, message: '`fonts` must be an array.' }
  const fonts: FontRef[] = []
  for (const [index, entry] of list.entries()) {
    const parsed = parseFontRef(entry, index)
    if (!parsed.ok) return parsed
    fonts.push(parsed.value)
  }
  return { ok: true, value: fonts }
}

/** Validates the JSON body into a `RenderRequest`; never trusts a field's shape. */
export function parseRenderRequest(body: unknown): ParseResult {
  if (!isRawRenderBody(body)) return { ok: false, message: 'The body must be a JSON object.' }
  if (!isObject(body.document)) {
    return { ok: false, message: '`document` must be the openpencil-scene-graph envelope.' }
  }
  const format = body.format ?? 'png'
  if (!oneOf(format, RENDER_FORMATS)) {
    return { ok: false, message: `\`format\` must be one of ${RENDER_FORMATS.join(', ')}.` }
  }
  if (body.mode !== undefined && !oneOf(body.mode, RENDER_MODES)) {
    return { ok: false, message: `\`mode\` must be one of ${RENDER_MODES.join(', ')}.` }
  }
  const fontPolicy = body.fontPolicy ?? 'strict'
  if (!oneOf(fontPolicy, FONT_POLICIES)) {
    return { ok: false, message: `\`fontPolicy\` must be one of ${FONT_POLICIES.join(', ')}.` }
  }
  const scale = parseScale(body.scale)
  if (!scale.ok) return scale
  const frameId = parseFrameId(body.frameId)
  if (!frameId.ok) return frameId
  const fonts = parseFonts(body.fonts)
  if (!fonts.ok) return fonts
  return {
    ok: true,
    request: {
      document: body.document,
      frameId: frameId.value,
      format,
      scale: scale.value,
      mode: body.mode as RenderMode | undefined,
      fonts: fonts.value,
      fontPolicy
    }
  }
}

/** Human sentence for the readiness gate: which text nodes could not be shaped and why. */
export function fontReadinessProblem(
  readiness: Readonly<Record<string, string>>,
  fontIssues: readonly string[]
): string | null {
  const notReady = Object.entries(readiness).filter(([, state]) => state !== 'ready')
  if (notReady.length === 0) return null
  const reasons: Record<string, string> = {
    substituted: 'shaped with a fallback font instead of the brand face',
    pending: 'still waiting for its font',
    exhausted: 'has no font that covers its characters'
  }
  const parts = notReady.map(([name, state]) => `“${name || 'text'}” ${reasons[state] ?? state}`)
  const missing = fontIssues.length > 0 ? ` Missing faces: ${fontIssues.join(', ')}.` : ''
  return `The brand fonts are not ready for this design: ${parts.join('; ')}.${missing}`
}
