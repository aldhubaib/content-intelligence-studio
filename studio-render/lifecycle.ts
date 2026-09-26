// CI: the render sidecar's lifetime — bounded renders and self-heal on heap
// exhaustion (INC-13).
//
// CanvasKit's WASM heap only grows; whatever a render leaves behind stays
// until the process ends, and once `MakeSurface` answers null (or the module
// aborts) nothing in the process will ever render again. The container's
// entrypoint already exits when the sidecar exits, and Railway restarts the
// container, so the cheapest way back to a fresh heap is to leave:
//
//   * recycle   — after `maxRenders` successful renders the sidecar stops
//                 accepting, finishes what is in flight and exits 0.
//   * exhausted — the engine reported heap exhaustion: the in-flight request
//                 is answered 503 `render_unavailable` (the app defers without
//                 spending an attempt) and the process exits 70.
//
// Both go through one `drain()`: stop the listener, wait for in-flight
// responses to flush (`Bun.serve().stop()` resolves when the connections have
// closed), exit — with a hard deadline so a stuck connection cannot keep a dead
// engine alive.

export type DrainReason = 'recycle' | 'surface-exhausted'

export const EXIT_CODE_EXHAUSTED = 70
export const DEFAULT_MAX_RENDERS = 40
const DEFAULT_GRACE_MS = 10_000

export interface LifecycleDeps {
  /** `0` disables the recycle. */
  maxRenders: number
  /** Stops accepting connections; resolves once in-flight responses are flushed. */
  stop: () => Promise<void> | void
  exit: (code: number) => void
  log?: (line: Record<string, unknown>) => void
  /** Hard deadline for `stop()` before `exit` is forced. */
  graceMs?: number
  /** Injected for tests. */
  setTimeout?: (fn: () => void, ms: number) => unknown
  rssMb?: () => number
}

export interface LifecycleState {
  state: 'serving' | 'draining'
  reason: DrainReason | null
  exitCode: number | null
}

export class SidecarLifecycle implements LifecycleState {
  state: LifecycleState['state'] = 'serving'
  reason: DrainReason | null = null
  exitCode: number | null = null
  private exited = false

  constructor(private readonly deps: LifecycleDeps) {}

  get draining(): boolean {
    return this.state === 'draining'
  }

  /** Called after every successful render with the process-lifetime count. */
  renderSucceeded(renders: number): void {
    const { maxRenders } = this.deps
    if (maxRenders > 0 && renders >= maxRenders && !this.draining) {
      this.deps.log?.({
        event: 'recycle',
        renders,
        maxRenders,
        rssMb: this.rssMb()
      })
      this.drain('recycle', 0)
    }
  }

  /** The engine reported that the WASM heap is exhausted. */
  exhausted(renders: number, message: string): void {
    if (this.draining) return
    this.deps.log?.({
      event: 'surface-exhausted',
      renders,
      rssMb: this.rssMb(),
      message
    })
    this.drain('surface-exhausted', EXIT_CODE_EXHAUSTED)
  }

  private rssMb(): number {
    const read = this.deps.rssMb ?? (() => process.memoryUsage().rss / (1024 * 1024))
    return Math.round(read())
  }

  private drain(reason: DrainReason, exitCode: number): void {
    this.state = 'draining'
    this.reason = reason
    this.exitCode = exitCode
    const schedule = this.deps.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
    const finish = () => {
      if (this.exited) return
      this.exited = true
      this.deps.exit(exitCode)
    }
    schedule(finish, this.deps.graceMs ?? DEFAULT_GRACE_MS)
    let stopped: Promise<void>
    try {
      stopped = Promise.resolve(this.deps.stop())
    } catch {
      stopped = Promise.resolve()
    }
    void stopped.then(finish, finish)
  }
}

/**
 * Heap exhaustion as the engine surfaces it: our own `SurfaceExhaustedError`
 * (`MakeSurface` → null) or a WASM `RuntimeError` — Emscripten's `Aborted()`
 * on a failed allocation leaves the module permanently unusable.
 */
export function isHeapExhaustion(error: unknown): boolean {
  if (error instanceof WebAssembly.RuntimeError) return true
  return Boolean(
    error &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'surface_exhausted'
  )
}
