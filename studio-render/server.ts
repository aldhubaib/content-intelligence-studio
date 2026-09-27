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
//   STUDIO_RENDER_MAX_RENDERS    successful renders before the process recycles itself
//                                (default 40, `0` = never; INC-13). Since S-11 the entrypoint
//                                supervises the sidecar and starts it again at once — a recycle
//                                costs a CanvasKit warm-up, never the editor.
//   STUDIO_RENDER_QUEUE_MAX      renders that may wait behind the ONE in flight (default 8,
//                                `0` = refuse whenever busy; S-11). Past that: 503 `render_busy`
//                                with `Retry-After`.

import {
  ENGINE_VERSION,
  RenderInputError,
  engineState,
  engineStats,
  renderDocument,
  warmEngine
} from './engine'
import { FontCache } from './font-cache'
import { DEFAULT_MAX_RENDERS, SidecarLifecycle, isHeapExhaustion } from './lifecycle'
import {
  type RenderErrorBody,
  type RenderErrorCode,
  type RenderHealthBody,
  type RenderQueueFacts,
  type RenderRequest,
  type SidecarHealthBody,
  fontReadinessProblem,
  parseRenderRequest
} from './protocol'
import { DEFAULT_QUEUE_MAX, QueueFullError, RenderQueue } from './queue'

export type SidecarLog = (line: Record<string, unknown>) => void

export interface SidecarOptions {
  secret: string | null
  maxBodyBytes: number
  fontCache: FontCache
  render?: typeof renderDocument
  log?: SidecarLog
  /** Recycle / self-heal (INC-13); absent in unit tests that only exercise the protocol. */
  lifecycle?: SidecarLifecycle
  /** One render at a time + bounded wait (S-11); absent → renders run unserialised (protocol tests). */
  queue?: RenderQueue
  /** Injected for tests; defaults to the engine's own counters. */
  stats?: typeof engineStats
}

export interface SidecarBootOptions extends SidecarOptions {
  port: number
  host: string
  warm: boolean
  maxRenders: number
  queueMax: number
}

const SECRET_MIN_LENGTH = 16
const MB = 1024 * 1024
const STARTED_AT = Date.now()

export function readOptions(
  env: Record<string, string | undefined> = process.env
): SidecarBootOptions {
  const secret = env.STUDIO_INTERNAL_SECRET?.trim() || null
  const number = (name: string, fallback: number, { allowZero = false } = {}) => {
    const raw = env[name]?.trim()
    const n = raw ? Number(raw) : Number.NaN
    if (!Number.isFinite(n)) return fallback
    if (n > 0) return n
    return allowZero && n === 0 ? 0 : fallback
  }
  return {
    secret: secret && secret.length >= SECRET_MIN_LENGTH ? secret : null,
    maxBodyBytes: Math.floor(number('STUDIO_RENDER_MAX_BODY_MB', 32) * MB),
    fontCache: new FontCache(Math.floor(number('STUDIO_RENDER_FONT_CACHE_MB', 64) * MB)),
    port: Math.floor(number('STUDIO_RENDER_PORT', 8788)),
    host: env.STUDIO_RENDER_HOST?.trim() || '127.0.0.1',
    warm: (env.STUDIO_RENDER_WARM ?? '1') !== '0',
    maxRenders: Math.floor(number('STUDIO_RENDER_MAX_RENDERS', DEFAULT_MAX_RENDERS, { allowZero: true })),
    queueMax: Math.floor(number('STUDIO_RENDER_QUEUE_MAX', DEFAULT_QUEUE_MAX, { allowZero: true }))
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

function queueFacts(queue: RenderQueue | undefined): RenderQueueFacts {
  return queue
    ? { inFlight: queue.inFlight, waiting: queue.waiting, capacity: queue.capacity }
    : { inFlight: 0, waiting: 0, capacity: 0 }
}

const uptimeSec = () => Math.round((Date.now() - STARTED_AT) / 1000)

/** `GET /internal/health` — bearer-gated process facts for the app's health page (INC-13). */
function processHealthResponse(options: SidecarOptions): Response {
  const stats = (options.stats ?? engineStats)()
  const body: SidecarHealthBody = {
    ok: !options.lifecycle?.draining,
    engineVersion: ENGINE_VERSION,
    renders: stats.renders,
    rssMb: Math.round(process.memoryUsage().rss / MB),
    heapMb: stats.heapBytes === null ? null : Math.round(stats.heapBytes / MB),
    uptimeSec: uptimeSec(),
    queue: queueFacts(options.queue)
  }
  return json(200, body)
}

/**
 * `GET /healthz/render` — the renderer's state without the bearer (S-11). nginx
 * proxies the public `/healthz/render` here so an operator (and later the app's
 * `/api/health`) sees the renderer separately from the editor's `/healthz`,
 * which stays 200 as long as nginx serves `dist/`. Read-only facts, nothing
 * about memory or the engine build.
 */
function renderHealthResponse(options: SidecarOptions): Response {
  const stats = (options.stats ?? engineStats)()
  const facts = queueFacts(options.queue)
  const body: RenderHealthBody = {
    ok: Boolean(options.secret) && !options.lifecycle?.draining,
    renders: stats.renders,
    uptimeSec: uptimeSec(),
    inFlight: facts.inFlight,
    waiting: facts.waiting
  }
  return json(200, body)
}

function drainingResponse(lifecycle: SidecarLifecycle): Response {
  const why =
    lifecycle.reason === 'surface-exhausted'
      ? 'the renderer is restarting after exhausting its memory'
      : 'the renderer is recycling'
  return fail(503, 'render_unavailable', `Render unavailable: ${why}; retry shortly.`)
}

/** S-11: the queue is full — say when to come back, in the body and in `Retry-After`. */
function busyResponse(retryAfterMs: number, options: SidecarOptions): Response {
  const facts = queueFacts(options.queue)
  options.log?.({ event: 'render.busy', waiting: facts.waiting, capacity: facts.capacity, retryAfterMs })
  return json(
    503,
    {
      error: 'render_busy',
      message: `Render busy: ${facts.waiting} renders are already waiting; retry in ${retryAfterMs} ms.`,
      retryAfterMs
    } satisfies RenderErrorBody,
    { 'retry-after': String(Math.max(1, Math.ceil(retryAfterMs / 1000))) }
  )
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
    const renders = (options.stats ?? engineStats)().renders
    options.log?.({
      event: 'render.ok',
      width: report.width,
      height: report.height,
      bytes: report.png.byteLength,
      ms: elapsed(),
      renders
    })
    options.lifecycle?.renderSucceeded(renders)
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
    if (isHeapExhaustion(error)) {
      // INC-13: nothing in this process renders again — answer 503 so the app
      // defers without an attempt, then exit so the container restarts.
      options.log?.({ event: 'render.failed', code: 'surface_exhausted', message, ms: elapsed() })
      const renders = (options.stats ?? engineStats)().renders
      options.lifecycle?.exhausted(renders, message)
      return fail(503, 'render_unavailable', `Render unavailable: ${message}; retry shortly.`)
    }
    options.log?.({ event: 'render.failed', message, ms: elapsed() })
    return fail(500, 'render_failed', message)
  }
}

export async function handleRequest(request: Request, options: SidecarOptions): Promise<Response> {
  const route = routeOf(new URL(request.url))

  if (route === '/healthz' || route === '/healthz/render') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return fail(405, 'bad_request', 'Method not allowed.')
    }
    return route === '/healthz' ? healthResponse(options) : renderHealthResponse(options)
  }

  if (route !== '/render' && route !== '/health') return fail(404, 'bad_request', 'Not found.')
  const expectedMethod = route === '/health' ? 'GET' : 'POST'
  if (request.method !== expectedMethod && !(route === '/health' && request.method === 'HEAD')) {
    return fail(405, 'bad_request', 'Method not allowed.')
  }
  if (!options.secret) {
    return fail(503, 'not_configured', 'STUDIO_INTERNAL_SECRET is not set on the Studio service.')
  }
  if (!bearerMatches(request.headers.get('authorization'), options.secret)) {
    return fail(401, 'unauthorized', 'Missing or invalid bearer.')
  }

  if (route === '/health') return processHealthResponse(options)
  return handleRender(request, options)
}

/** `POST /internal/render` past the bearer: drain gate → queue gate → body → fonts → the serialised render. */
async function handleRender(request: Request, options: SidecarOptions): Promise<Response> {
  if (options.lifecycle?.draining) return drainingResponse(options.lifecycle)
  // S-11: refuse before reading a body the engine would never see.
  if (options.queue?.full) return busyResponse(options.queue.estimateWaitMs(), options)

  const body = await readRenderBody(request, options)
  if (!body.ok) return body.response

  const fonts = await options.fontCache.resolve(body.request.fonts)
  if (!fonts.ok) return fontsFailure(fonts)

  const render = (): Promise<Response> => {
    // A render that waited its turn while the process began draining is not
    // started: the drain exists to stop the heap growing (INC-13), and the
    // caller defers on 503 exactly as it would have at arrival.
    if (options.lifecycle?.draining) return Promise.resolve(drainingResponse(options.lifecycle))
    return renderResponse(
      body.request,
      fonts.fonts.map((f) => ({ family: f.family, weight: f.weight, data: f.data })),
      options
    )
  }
  if (!options.queue) return render()
  try {
    return await options.queue.run(render)
  } catch (error) {
    if (error instanceof QueueFullError) return busyResponse(error.retryAfterMs, options)
    throw error
  }
}

export function startSidecar(env: Record<string, string | undefined> = process.env) {
  const options = readOptions(env)
  const log: SidecarLog = (line) => {
    // oxlint-disable-next-line no-console -- the sidecar's structured log line
    console.log(JSON.stringify({ ts: new Date().toISOString(), service: 'studio-render', ...line }))
  }
  // INC-13: bounded lifetime + self-heal. `server.stop()` (no force) stops the
  // listener and resolves once in-flight responses — the 503 included — have
  // been flushed; the entrypoint (S-11) sees the exit and starts a fresh
  // sidecar at once while nginx keeps serving the editor.
  const lifecycle: SidecarLifecycle = new SidecarLifecycle({
    maxRenders: options.maxRenders,
    stop: (): Promise<void> => server.stop(),
    exit: (code) => process.exit(code),
    log
  })
  // S-11: one render at a time, a bounded queue behind it.
  const queue = new RenderQueue({ maxWaiting: options.queueMax })
  const server = Bun.serve({
    port: options.port,
    hostname: options.host,
    maxRequestBodySize: options.maxBodyBytes,
    idleTimeout: 120,
    fetch: (request): Promise<Response> =>
      handleRequest(request, { ...options, log, lifecycle, queue })
  })
  log({
    event: 'listening',
    host: options.host,
    port: server.port,
    engine: ENGINE_VERSION,
    configured: Boolean(options.secret),
    maxBodyMb: options.maxBodyBytes / MB,
    maxRenders: options.maxRenders,
    queueMax: options.queueMax
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
