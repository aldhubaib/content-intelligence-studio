// CI: shared fixtures for the render sidecar's HTTP tests (Track E3c Part E, INC-13, S-11).
import { FontCache } from '#studio-render/font-cache'
import { SidecarLifecycle } from '#studio-render/lifecycle'
import type { SidecarOptions } from '#studio-render/server'

export const SECRET = 'test-secret-0123456789abcdef'

export function options(overrides: Partial<SidecarOptions> = {}): SidecarOptions {
  return {
    secret: SECRET,
    maxBodyBytes: 32 * 1024 * 1024,
    fontCache: new FontCache(64 * 1024 * 1024),
    ...overrides
  }
}

export function post(
  body: unknown,
  headers: Record<string, string> = { authorization: `Bearer ${SECRET}` }
): Request {
  return new Request('http://sidecar/internal/render', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}

export interface JSONBody {
  ok?: boolean
  engine?: string
  configured?: boolean
  canvasKit?: string
  emojiFace?: boolean
  error?: string
  message?: string
  missing?: string[]
  report?: { fontIssues?: string[]; textReadiness?: Record<string, string> }
}

export async function bodyOf(res: Response): Promise<JSONBody> {
  return (await res.json()) as JSONBody
}

export const fakeReport = (): Awaited<ReturnType<NonNullable<SidecarOptions['render']>>> => ({
  png: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0]),
  width: 1,
  height: 1,
  frameId: 'f',
  mode: 'direct',
  engineVersion: '0.15.1',
  fontIssues: [],
  textReadiness: {},
  emojiFallback: true,
  timings: { canvasKitMs: 0, parseMs: 0, fontsMs: 0, renderMs: 0 }
})

export interface FakeLifecycleDeps {
  maxRenders?: number
  stopResolves?: boolean
}

export interface FakeLifecycleCalls {
  stop: number
  exit: number[]
  timers: Array<() => void>
  logs: Record<string, unknown>[]
}

/** A lifecycle whose `stop` / `exit` / timers are recorded instead of touching the process. */
export function fakeLifecycle({ maxRenders = 3, stopResolves = true }: FakeLifecycleDeps = {}) {
  const calls: FakeLifecycleCalls = { stop: 0, exit: [], timers: [], logs: [] }
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

/** One macrotask, so promise chains and `stop().then(exit)` settle. */
export const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

/** A promise the test settles by hand. */
export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((settleIt) => {
    resolve = settleIt
  })
  return { promise, resolve }
}

/** A render whose completion the test controls, tagged by `document.tag` so order can be asserted. */
export function controlledRender() {
  const gates: Array<() => void> = []
  const started: string[] = []
  const render: SidecarOptions['render'] = async (input) => {
    const tag = (input.document as { tag?: string }).tag ?? '?'
    started.push(tag)
    const { promise, resolve } = deferred()
    gates.push(resolve)
    await promise
    return { ...fakeReport(), frameId: tag }
  }
  return { render, gates, started, releaseNext: () => gates.shift()?.() }
}

export const renderBody = (tag: string) => ({ document: { tag }, format: 'png', scale: 1 })
