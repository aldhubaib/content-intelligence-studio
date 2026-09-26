// CI: render sidecar HTTP behaviour end to end — real engine, real PNG (Track E3c Part E).
import { describe, expect, test } from 'bun:test'

import { FontCache, sha256Hex } from '#studio-render/font-cache'
import { EXIT_CODE_EXHAUSTED, SidecarLifecycle, isHeapExhaustion } from '#studio-render/lifecycle'
import type { SidecarHealthBody } from '#studio-render/protocol'
import { type SidecarOptions, handleRequest, readOptions } from '#studio-render/server'

const SECRET = 'test-secret-0123456789abcdef'
const FIXTURE = new URL('../../fixtures/ci/hosted-template.json', import.meta.url)
const NOTO = new URL('../../../packages/core/assets/NotoNaskhArabic-Regular.ttf', import.meta.url)

function options(overrides: Partial<SidecarOptions> = {}): SidecarOptions {
  return {
    secret: SECRET,
    maxBodyBytes: 32 * 1024 * 1024,
    fontCache: new FontCache(64 * 1024 * 1024),
    ...overrides
  }
}

function post(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }
): Request {
  return new Request('http://sidecar/internal/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

async function fixtureDocument(): Promise<unknown> {
  return Bun.file(FIXTURE).json()
}

interface JSONBody {
  ok?: boolean
  engine?: string
  configured?: boolean
  canvasKit?: string
  error?: string
  message?: string
  missing?: string[]
  report?: { fontIssues?: string[]; textReadiness?: Record<string, string> }
}

async function bodyOf(res: Response): Promise<JSONBody> {
  return (await res.json()) as JSONBody
}

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]

describe('readOptions', () => {
  test('defaults', () => {
    const opts = readOptions({})
    expect(opts.secret).toBeNull()
    expect(opts.port).toBe(8788)
    expect(opts.host).toBe('127.0.0.1')
    expect(opts.maxBodyBytes).toBe(32 * 1024 * 1024)
    expect(opts.warm).toBe(true)
  })

  test('a short secret is treated as unset', () => {
    expect(readOptions({ STUDIO_INTERNAL_SECRET: 'short' }).secret).toBeNull()
    expect(readOptions({ STUDIO_INTERNAL_SECRET: SECRET }).secret).toBe(SECRET)
  })

  test('numbers and switches', () => {
    const opts = readOptions({
      STUDIO_RENDER_PORT: '9000',
      STUDIO_RENDER_MAX_BODY_MB: '4',
      STUDIO_RENDER_WARM: '0',
      STUDIO_RENDER_HOST: '0.0.0.0'
    })
    expect(opts.port).toBe(9000)
    expect(opts.maxBodyBytes).toBe(4 * 1024 * 1024)
    expect(opts.warm).toBe(false)
    expect(opts.host).toBe('0.0.0.0')
  })

  test('STUDIO_RENDER_MAX_RENDERS defaults to 40, accepts 0 as never, ignores junk', () => {
    expect(readOptions({}).maxRenders).toBe(40)
    expect(readOptions({ STUDIO_RENDER_MAX_RENDERS: '0' }).maxRenders).toBe(0)
    expect(readOptions({ STUDIO_RENDER_MAX_RENDERS: '12' }).maxRenders).toBe(12)
    expect(readOptions({ STUDIO_RENDER_MAX_RENDERS: '-3' }).maxRenders).toBe(40)
    expect(readOptions({ STUDIO_RENDER_MAX_RENDERS: 'many' }).maxRenders).toBe(40)
  })
})

interface FakeLifecycleDeps {
  maxRenders?: number
  stopResolves?: boolean
}

/** A lifecycle whose `stop` / `exit` / timers are recorded instead of touching the process. */
function fakeLifecycle({ maxRenders = 3, stopResolves = true }: FakeLifecycleDeps = {}) {
  const calls: { stop: number; exit: number[]; timers: Array<() => void>; logs: Record<string, unknown>[] } = {
    stop: 0,
    exit: [],
    timers: [],
    logs: []
  }
  const lifecycle = new SidecarLifecycle({
    maxRenders,
    stop: () => {
      calls.stop += 1
      if (stopResolves) return Promise.resolve()
      // A stop that never settles: the hard deadline must exit anyway.
      return new Promise<void>(() => {
        /* never resolves */
      })
    },
    exit: (code) => calls.exit.push(code),
    log: (line) => calls.logs.push(line),
    setTimeout: (fn) => calls.timers.push(fn),
    rssMb: () => 123
  })
  return { lifecycle, calls }
}

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

describe('SidecarLifecycle', () => {
  test('recycles once the successful render count reaches the cap — stop, then exit 0', async () => {
    const { lifecycle, calls } = fakeLifecycle({ maxRenders: 3 })
    lifecycle.renderSucceeded(1)
    lifecycle.renderSucceeded(2)
    expect(lifecycle.draining).toBe(false)
    lifecycle.renderSucceeded(3)
    expect(lifecycle.state).toBe('draining')
    expect(lifecycle.reason).toBe('recycle')
    expect(calls.stop).toBe(1)
    await settle()
    expect(calls.exit).toEqual([0])
    expect(calls.logs).toEqual([{ event: 'recycle', renders: 3, maxRenders: 3, rssMb: 123 }])
    // A second signal never drains twice.
    lifecycle.renderSucceeded(4)
    lifecycle.exhausted(4, 'late')
    await settle()
    expect(calls.stop).toBe(1)
    expect(calls.exit).toEqual([0])
  })

  test('maxRenders 0 never recycles', () => {
    const { lifecycle, calls } = fakeLifecycle({ maxRenders: 0 })
    lifecycle.renderSucceeded(10_000)
    expect(lifecycle.draining).toBe(false)
    expect(calls.stop).toBe(0)
  })

  test('exhaustion exits 70 after stop, and the grace timer forces the exit when stop hangs', async () => {
    const { lifecycle, calls } = fakeLifecycle({ stopResolves: false })
    lifecycle.exhausted(41, 'CanvasKit could not create the export surface')
    expect(lifecycle.reason).toBe('surface-exhausted')
    expect(calls.logs[0]).toEqual({
      event: 'surface-exhausted',
      renders: 41,
      rssMb: 123,
      message: 'CanvasKit could not create the export surface'
    })
    await settle()
    expect(calls.exit).toEqual([])
    expect(calls.timers).toHaveLength(1)
    calls.timers[0]?.()
    expect(calls.exit).toEqual([EXIT_CODE_EXHAUSTED])
    calls.timers[0]?.()
    expect(calls.exit).toEqual([EXIT_CODE_EXHAUSTED])
  })

  test('isHeapExhaustion recognises the engine error and a WASM abort, nothing else', () => {
    expect(isHeapExhaustion({ code: 'surface_exhausted' })).toBe(true)
    expect(isHeapExhaustion(new WebAssembly.RuntimeError('Aborted()'))).toBe(true)
    expect(isHeapExhaustion(new Error('boom'))).toBe(false)
    expect(isHeapExhaustion(null)).toBe(false)
  })
})

describe('handleRequest', () => {
  test('healthz answers without a bearer, with and without the /internal prefix', async () => {
    const opts = options()
    for (const url of ['http://sidecar/internal/healthz', 'http://sidecar/healthz']) {
      const res = await handleRequest(new Request(url), opts)
      expect(res.status).toBe(200)
      const body = await bodyOf(res)
      expect(body.ok).toBe(true)
      expect(body.engine).toBe('0.15.1')
      expect(body.configured).toBe(true)
      expect(['cold', 'warming', 'ready']).toContain(body.canvasKit ?? '')
    }
  })

  test('unknown routes and methods', async () => {
    expect(
      (await handleRequest(new Request('http://sidecar/internal/other'), options())).status
    ).toBe(404)
    expect(
      (await handleRequest(new Request('http://sidecar/internal/render'), options())).status
    ).toBe(405)
  })

  test('503 without a secret, 401 with the wrong one', async () => {
    const res = await handleRequest(post({}), options({ secret: null }))
    expect(res.status).toBe(503)
    expect((await bodyOf(res)).error).toBe('not_configured')
    const wrong = await handleRequest(post({}, { authorization: 'Bearer nope' }), options())
    expect(wrong.status).toBe(401)
    const none = await handleRequest(post({}, {}), options())
    expect(none.status).toBe(401)
  })

  test('400 for invalid JSON and invalid requests, 413 past the body cap', async () => {
    const opts = options()
    expect((await handleRequest(post('{not json'), opts)).status).toBe(400)
    const bad = await handleRequest(post({ document: {}, scale: 99 }), opts)
    expect(bad.status).toBe(400)
    expect((await bodyOf(bad)).message).toContain('`scale`')
    const big = await handleRequest(post({ document: {} }), options({ maxBodyBytes: 4 }))
    expect(big.status).toBe(413)
  })

  test('428 lists the unknown font hashes; resending with data renders and caches', async () => {
    const opts = options()
    const document = await fixtureDocument()
    const fontBytes = await Bun.file(NOTO).arrayBuffer()
    const hash = await sha256Hex(fontBytes)
    const fonts = [{ family: 'Brand Arabic', weight: 400 as const, hash }]

    const first = await handleRequest(post({ document, format: 'png', scale: 1, fonts }), opts)
    expect(first.status).toBe(428)
    expect(await bodyOf(first)).toEqual({
      error: 'fonts_missing',
      message: 'Send the bytes for these font hashes.',
      missing: [hash]
    })

    const data = Buffer.from(fontBytes).toString('base64')
    const second = await handleRequest(
      post({ document, format: 'png', scale: 1, fonts: [{ ...fonts[0], data }] }),
      opts
    )
    expect(second.status).toBe(200)
    expect(second.headers.get('content-type')).toBe('image/png')
    expect(second.headers.get('x-render-width')).toBe('1080')
    expect(second.headers.get('x-render-height')).toBe('1350')
    expect(second.headers.get('x-render-engine')).toBe('0.15.1')
    const report = JSON.parse(second.headers.get('x-render-report') ?? '{}') as NonNullable<
      JSONBody['report']
    >
    expect(report.textReadiness).toEqual({ 'content:title': 'ready' })
    const png = new Uint8Array(await second.arrayBuffer())
    expect(Array.from(png.slice(0, 4))).toEqual(PNG_MAGIC)
    expect(opts.fontCache.size).toBe(1)

    const third = await handleRequest(post({ document, format: 'png', scale: 2, fonts }), opts)
    expect(third.status).toBe(200)
    expect(third.headers.get('x-render-width')).toBe('2160')
    expect(third.headers.get('x-render-height')).toBe('2700')
  }, 30_000)

  test('renders without fonts (engine defaults) and reports the frame', async () => {
    const document = await fixtureDocument()
    const res = await handleRequest(post({ document, format: 'png', scale: 0.5 }), options())
    expect(res.status).toBe(200)
    expect(res.headers.get('x-render-width')).toBe('540')
    expect(res.headers.get('x-render-frame')).toBeTruthy()
  }, 30_000)

  test('422 for a document that is not the envelope and for an unknown frame', async () => {
    const opts = options()
    const notDoc = await handleRequest(
      post({ document: { hello: 1 }, format: 'png', scale: 1 }),
      opts
    )
    expect(notDoc.status).toBe(422)
    expect((await bodyOf(notDoc)).error).toBe('unsupported_document')
    const document = await fixtureDocument()
    const noFrame = await handleRequest(
      post({ document, frameId: 'missing', format: 'png', scale: 1 }),
      opts
    )
    expect(noFrame.status).toBe(422)
    expect((await bodyOf(noFrame)).error).toBe('frame_not_found')
  }, 30_000)

  test('422 fonts_not_ready under strict policy, 200 under warn, when the engine reports substitution', async () => {
    const document = await fixtureDocument()
    const render: SidecarOptions['render'] = async () => ({
      png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]),
      width: 1,
      height: 1,
      frameId: 'f',
      mode: 'direct',
      engineVersion: '0.15.1',
      fontIssues: ['Brand Latin Bold (missing)'],
      textReadiness: { 'slot:headline': 'substituted' },
      timings: { canvasKitMs: 0, parseMs: 0, fontsMs: 0, renderMs: 0 }
    })
    const strict = await handleRequest(
      post({ document, format: 'png', scale: 1 }),
      options({ render })
    )
    expect(strict.status).toBe(422)
    const body = await bodyOf(strict)
    expect(body.error).toBe('fonts_not_ready')
    expect(body.message).toContain('“slot:headline” shaped with a fallback font')
    expect(body.report?.fontIssues).toEqual(['Brand Latin Bold (missing)'])
    const warn = await handleRequest(
      post({ document, format: 'png', scale: 1, fontPolicy: 'warn' }),
      options({ render })
    )
    expect(warn.status).toBe(200)
    expect(
      (JSON.parse(warn.headers.get('x-render-report') ?? '{}') as JSONBody['report'])?.textReadiness
    ).toEqual({
      'slot:headline': 'substituted'
    })
  })

  test('500 render_failed when the engine throws', async () => {
    const render: SidecarOptions['render'] = async () => {
      throw new Error('boom')
    }
    const res = await handleRequest(
      post({ document: {}, format: 'png', scale: 1 }),
      options({ render })
    )
    expect(res.status).toBe(500)
    expect(await bodyOf(res)).toEqual({ error: 'render_failed', message: 'boom' })
  })
})

const fakeReport = (): Awaited<ReturnType<NonNullable<SidecarOptions['render']>>> => ({
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]),
  width: 1,
  height: 1,
  frameId: 'f',
  mode: 'direct',
  engineVersion: '0.15.1',
  fontIssues: [],
  textReadiness: {},
  timings: { canvasKitMs: 0, parseMs: 0, fontsMs: 0, renderMs: 0 }
})

describe('handleRequest — lifetime (INC-13)', () => {
  test('GET /internal/health is bearer-gated and reports process facts', async () => {
    let renders = 7
    const stats: SidecarOptions['stats'] = () => ({ renders, heapBytes: 128 * 1024 * 1024 })
    const opts = options({ stats })
    const none = await handleRequest(new Request('http://sidecar/internal/health'), opts)
    expect(none.status).toBe(401)
    const wrong = await handleRequest(
      new Request('http://sidecar/internal/health', { headers: { authorization: 'Bearer nope' } }),
      opts
    )
    expect(wrong.status).toBe(401)
    const posted = await handleRequest(
      new Request('http://sidecar/internal/health', {
        method: 'POST',
        headers: { authorization: `Bearer ${SECRET}` }
      }),
      opts
    )
    expect(posted.status).toBe(405)
    const res = await handleRequest(
      new Request('http://sidecar/internal/health', { headers: { authorization: `Bearer ${SECRET}` } }),
      opts
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as SidecarHealthBody
    expect(body.ok).toBe(true)
    expect(body.engineVersion).toBe('0.15.1')
    expect(body.renders).toBe(7)
    expect(body.heapMb).toBe(128)
    expect(typeof body.rssMb).toBe('number')
    expect(typeof body.uptimeSec).toBe('number')
    renders = 8
    const unconfigured = await handleRequest(
      new Request('http://sidecar/internal/health', { headers: { authorization: `Bearer ${SECRET}` } }),
      options({ stats, secret: null })
    )
    expect(unconfigured.status).toBe(503)
  })

  test('the Nth successful render recycles: stop is called and later renders answer 503', async () => {
    let renders = 0
    const render: SidecarOptions['render'] = async () => {
      renders += 1
      return fakeReport()
    }
    const stats: SidecarOptions['stats'] = () => ({ renders, heapBytes: null })
    const { lifecycle, calls } = fakeLifecycle({ maxRenders: 2 })
    const opts = options({ render, stats, lifecycle })
    const body = { document: {}, format: 'png', scale: 1 }
    expect((await handleRequest(post(body), opts)).status).toBe(200)
    expect(lifecycle.draining).toBe(false)
    const second = await handleRequest(post(body), opts)
    expect(second.status).toBe(200) // the Nth render is still answered with its PNG
    expect(lifecycle.draining).toBe(true)
    expect(calls.stop).toBe(1)
    await settle()
    expect(calls.exit).toEqual([0])
    const third = await handleRequest(post(body), opts)
    expect(third.status).toBe(503)
    expect(await bodyOf(third)).toEqual({
      error: 'render_unavailable',
      message: 'Render unavailable: the renderer is recycling; retry shortly.'
    })
    expect(renders).toBe(2)
    const health = await handleRequest(
      new Request('http://sidecar/internal/health', { headers: { authorization: `Bearer ${SECRET}` } }),
      opts
    )
    expect(((await health.json()) as { ok: boolean }).ok).toBe(false)
  })

  test('heap exhaustion answers 503 render_unavailable and exits 70 — never 500', async () => {
    const render: SidecarOptions['render'] = async () => {
      throw Object.assign(new Error('[studio-render] CanvasKit could not create the export surface'), {
        code: 'surface_exhausted'
      })
    }
    const stats: SidecarOptions['stats'] = () => ({ renders: 41, heapBytes: 2 * 1024 * 1024 * 1024 })
    const { lifecycle, calls } = fakeLifecycle({ maxRenders: 0 })
    const opts = options({ render, stats, lifecycle })
    const res = await handleRequest(post({ document: {}, format: 'png', scale: 1 }), opts)
    expect(res.status).toBe(503)
    const body = await bodyOf(res)
    expect(body.error).toBe('render_unavailable')
    expect(body.message).toContain('could not create the export surface')
    expect(lifecycle.reason).toBe('surface-exhausted')
    await settle()
    expect(calls.exit).toEqual([EXIT_CODE_EXHAUSTED])
    expect(calls.logs.map((l) => l.event)).toEqual(['surface-exhausted'])
  })

  test('a WASM abort is exhaustion too', async () => {
    const render: SidecarOptions['render'] = async () => {
      throw new WebAssembly.RuntimeError('Aborted(). Build with -sASSERTIONS for more info.')
    }
    const { lifecycle, calls } = fakeLifecycle({ maxRenders: 0 })
    const res = await handleRequest(
      post({ document: {}, format: 'png', scale: 1 }),
      options({ render, lifecycle })
    )
    expect(res.status).toBe(503)
    await settle()
    expect(calls.exit).toEqual([EXIT_CODE_EXHAUSTED])
  })
})
