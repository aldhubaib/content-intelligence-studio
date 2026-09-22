// CI: the render sidecar — a small Bun HTTP server in the Studio image that
// turns an `openpencil-scene-graph` document into a PNG with the pinned engine
// (ADR-058 §8, Track E3c Part E). nginx proxies `/internal/` to it; the app
// calls it server-to-server with `Authorization: Bearer <STUDIO_INTERNAL_SECRET>`.
//
//   bun studio-render/server.ts            (STUDIO_INTERNAL_SECRET required)
//
// Environment
//   STUDIO_INTERNAL_SECRET       bearer the app presents (≥ 16 chars). Without it every
//                                render is 503 `not_configured` — the process still boots
//                                so /internal/healthz can say so.
//   STUDIO_RENDER_PORT           listen port (default 8788, matches the nginx proxy).
//   STUDIO_RENDER_HOST           bind address (default 127.0.0.1 — only nginx talks to it).
//   STUDIO_RENDER_MAX_BODY_MB    request body cap (default 32).
//   STUDIO_RENDER_FONT_CACHE_MB  in-memory font cache cap (default 64).
//   STUDIO_RENDER_WARM           `1` (default) warms CanvasKit at boot.

import { ENGINE_VERSION, RenderInputError, engineState, renderDocument, warmEngine } from './engine'
import { FontCache } from './font-cache'
import {
  type RenderErrorBody,
  type RenderErrorCode,
  type RenderRequest,
  fontReadinessProblem,
  parseRenderRequest
} from './protocol'

export type SidecarLog = (line: Record<string, unknown>) => void

export interface SidecarOptions {
  secret: string | null
  maxBodyBytes: number
  fontCache: FontCache
  render?: typeof renderDocument
  log?: SidecarLog
}

export interface SidecarBootOptions extends SidecarOptions {
  port: number
  host: string
  warm: boolean
}

const SECRET_MIN_LENGTH = 16
const MB = 1024 * 1024

export function readOptions(
  env: Record<string, string | undefined> = process.env
): SidecarBootOptions {
  const secret = env.STUDIO_INTERNAL_SECRET?.trim() || null
  const number = (name: string, fallback: number) => {
    const raw = env[name]?.trim()
    const n = raw ? Number(raw) : Number.NaN
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    secret: secret && secret.length >= SECRET_MIN_LENGTH ? secret : null,
    maxBodyBytes: Math.floor(number('STUDIO_RENDER_MAX_BODY_MB', 32) * MB),
    fontCache: new FontCache(Math.floor(number('STUDIO_RENDER_FONT_CACHE_MB', 64) * MB)),
    port: Math.floor(number('STUDIO_RENDER_PORT', 8788)),
    host: env.STUDIO_RENDER_HOST?.trim() || '127.0.0.1',
    warm: (env.STUDIO_RENDER_WARM ?? '1') !== '0'
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers
    }
  })
}

function fail(
  status: number,
  error: RenderErrorCode,
  message: string,
  extra: Partial<RenderErrorBody> = {}
): Response {
  return json(status, { error, message, ...extra } satisfies RenderErrorBody)
}

/** Constant-time bearer comparison. */
function bearerMatches(header: string | null, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false
  const presented = header.slice('Bearer '.length).trim()
  if (presented.length !== secret.length) return false
  let diff = 0
  for (let i = 0; i < secret.length; i += 1) diff |= presented.charCodeAt(i) ^ secret.charCodeAt(i)
  return diff === 0
}

/** Strip the `/internal` prefix nginx keeps when proxying so both shapes work. */
function routeOf(url: URL): string {
  return url.pathname.replace(/^\/internal(?=\/|$)/, '') || '/'
}

function healthResponse(options: SidecarOptions): Response {
  return json(200, {
    ok: true,
    engine: ENGINE_VERSION,
    canvasKit: engineState(),
    configured: Boolean(options.secret),
    fontsCached: options.fontCache.size
  })
}

type BodyResult = { ok: true; request: RenderRequest } | { ok: false; response: Response }

async function readRenderBody(request: Request, options: SidecarOptions): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length') ?? '0')
  const tooLarge = () => fail(413, 'payload_too_large', `Body above ${options.maxBodyBytes} bytes.`)
  if (declared > options.maxBodyBytes) return { ok: false, response: tooLarge() }
  let text: string
  try {
    text = await request.text()
  } catch {
    return { ok: false, response: fail(400, 'bad_request', 'Could not read the body.') }
  }
  if (text.length > options.maxBodyBytes) return { ok: false, response: tooLarge() }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return { ok: false, response: fail(400, 'bad_request', 'The body is not valid JSON.') }
  }
  const parsed = parseRenderRequest(body)
  if (!parsed.ok) return { ok: false, response: fail(400, 'bad_request', parsed.message) }
  return { ok: true, request: parsed.request }
}

function fontsFailure(
  result: Exclude<Awaited<ReturnType<FontCache['resolve']>>, { ok: true }>
): Response {
  if (result.reason === 'missing') {
    return fail(428, 'fonts_missing', 'Send the bytes for these font hashes.', {
      missing: result.missing
    })
  }
  const message =
    result.reason === 'hash_mismatch'
      ? `fonts: the bytes sent for ${result.hash} do not match their hash.`
      : `fonts: the base64 for ${result.hash} is invalid.`
  return fail(400, 'bad_request', message)
}

async function renderResponse(
  req: RenderRequest,
  fonts: { family: string; weight: 400 | 700; data: ArrayBuffer }[],
  options: SidecarOptions
): Promise<Response> {
  const started = performance.now()
  const elapsed = () => Math.round(performance.now() - started)
  try {
    const render = options.render ?? renderDocument
    const report = await render({
      document: req.document,
      frameId: req.frameId,
      scale: req.scale,
      mode: req.mode,
      fonts
    })
    const summary = {
      engineVersion: report.engineVersion,
      mode: report.mode,
      fontIssues: report.fontIssues,
      textReadiness: report.textReadiness,
      timings: report.timings
    }
    const problem = fontReadinessProblem(report.textReadiness, report.fontIssues)
    if (problem && req.fontPolicy === 'strict') {
      options.log?.({ event: 'render.refused', code: 'fonts_not_ready', ms: elapsed() })
      return fail(422, 'fonts_not_ready', problem, { report: summary })
    }
    options.log?.({
      event: 'render.ok',
      width: report.width,
      height: report.height,
      bytes: report.png.byteLength,
      ms: elapsed()
    })
    return new Response(report.png.slice() as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': String(report.png.byteLength),
        'cache-control': 'no-store',
        'x-render-width': String(report.width),
        'x-render-height': String(report.height),
        'x-render-frame': report.frameId,
        'x-render-engine': report.engineVersion,
        'x-render-report': JSON.stringify(summary)
      }
    })
  } catch (error) {
    if (error instanceof RenderInputError) {
      options.log?.({ event: 'render.refused', code: error.code, ms: elapsed() })
      return fail(422, error.code, error.message)
    }
    const message = error instanceof Error ? error.message : String(error)
    options.log?.({ event: 'render.failed', message, ms: elapsed() })
    return fail(500, 'render_failed', message)
  }
}

export async function handleRequest(request: Request, options: SidecarOptions): Promise<Response> {
  const route = routeOf(new URL(request.url))

  if (route === '/healthz') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, 'bad_request', 'Method not allowed.')
    }
    return healthResponse(options)
  }

  if (route !== '/render') return fail(404, 'bad_request', 'Not found.')
  if (request.method !== 'POST') return fail(405, 'bad_request', 'Method not allowed.')
  if (!options.secret) {
    return fail(503, 'not_configured', 'STUDIO_INTERNAL_SECRET is not set on the Studio service.')
  }
  if (!bearerMatches(request.headers.get('authorization'), options.secret)) {
    return fail(401, 'unauthorized', 'Missing or invalid bearer.')
  }

  const body = await readRenderBody(request, options)
  if (!body.ok) return body.response

  const fonts = await options.fontCache.resolve(body.request.fonts)
  if (!fonts.ok) return fontsFailure(fonts)

  return renderResponse(
    body.request,
    fonts.fonts.map((f) => ({ family: f.family, weight: f.weight, data: f.data })),
    options
  )
}

export function startSidecar(env: Record<string, string | undefined> = process.env) {
  const options = readOptions(env)
  const log: SidecarLog = (line) => {
    // oxlint-disable-next-line no-console -- the sidecar's structured log line
    console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'studio-render', ...line }))
  }
  const server = Bun.serve({
    port: options.port,
    hostname: options.host,
    maxRequestBodySize: options.maxBodyBytes,
    idleTimeout: 120,
    fetch: (request) => handleRequest(request, { ...options, log })
  })
  log({
    event: 'listening',
    host: options.host,
    port: server.port,
    engine: ENGINE_VERSION,
    configured: Boolean(options.secret),
    maxBodyMb: options.maxBodyBytes / MB
  })
  if (!options.secret) {
    log({
      event: 'warning',
      message: 'STUDIO_INTERNAL_SECRET is unset or shorter than 16 chars; renders answer 503'
    })
  }
  if (options.warm) {
    warmEngine()
      .then(() => log({ event: 'engine.ready' }))
      .catch((error: unknown) =>
        log({
          event: 'engine.failed',
          message: error instanceof Error ? error.message : String(error)
        })
      )
  }
  const stop = () => {
    log({ event: 'stopping' })
    server.stop()
    process.exit(0)
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  return server
}

if (import.meta.main) startSidecar()
