// CI: renders are serialised — one in flight, a bounded wait queue (S-11, INC-18).
//
// CanvasKit is one WASM heap per process; two renders at once double the peak
// allocation and, under a burst, the second `MakeSurface` is what fails. Under
// the first real load (two worker replicas at ≈ 1 render / s) the sidecar took
// every request concurrently and died within seconds of each restart. The
// queue makes the sidecar's capacity explicit instead:
//
//   * at most ONE render runs; arrivals wait in order;
//   * at most `maxWaiting` may wait — the next arrival is refused at once and
//     the server answers 503 `render_busy` with `retryAfterMs` (the caller,
//     the app's `studio` renderer, defers the job without spending an attempt);
//   * `estimateWaitMs()` is what a new arrival would wait: the queue depth
//     times an exponential moving average of recent render durations.

export class QueueFullError extends Error {
  readonly code = 'render_busy' as const

  constructor(readonly retryAfterMs: number) {
    super(`Render queue is full; retry in ${retryAfterMs} ms.`)
    this.name = 'QueueFullError'
  }
}

export interface RenderQueueOptions {
  /** How many renders may wait behind the one in flight. `0` = refuse whenever busy. */
  maxWaiting: number
  /** Assumed duration before the first measurement (ms). */
  assumedMs?: number
  /** Floor for the advertised wait (ms). */
  minRetryAfterMs?: number
  /** Injected for tests. */
  now?: () => number
}

const DEFAULT_ASSUMED_MS = 1_500
const DEFAULT_MIN_RETRY_AFTER_MS = 1_000
const EMA_ALPHA = 0.3

export const DEFAULT_QUEUE_MAX = 8

export class RenderQueue {
  private running = false
  private readonly waiters: Array<() => void> = []
  private averageMs: number | null = null
  private readonly maxWaiting: number
  private readonly assumedMs: number
  private readonly minRetryAfterMs: number
  private readonly now: () => number

  constructor(options: RenderQueueOptions) {
    this.maxWaiting = Math.max(0, Math.floor(options.maxWaiting))
    this.assumedMs = options.assumedMs ?? DEFAULT_ASSUMED_MS
    this.minRetryAfterMs = options.minRetryAfterMs ?? DEFAULT_MIN_RETRY_AFTER_MS
    this.now = options.now ?? (() => performance.now())
  }

  /** 1 while a render runs, else 0. */
  get inFlight(): number {
    return this.running ? 1 : 0
  }

  get waiting(): number {
    return this.waiters.length
  }

  get capacity(): number {
    return this.maxWaiting
  }

  /** True when a new arrival would be refused. */
  get full(): boolean {
    return this.running && this.waiters.length >= this.maxWaiting
  }

  /** Recent average render duration, or the assumption before any measurement. */
  get averageRenderMs(): number {
    return this.averageMs ?? this.assumedMs
  }

  /** What a new arrival would wait before its render starts (ms, floored). */
  estimateWaitMs(): number {
    const ahead = this.inFlight + this.waiters.length
    return Math.max(this.minRetryAfterMs, Math.round(ahead * this.averageRenderMs))
  }

  /**
   * Runs `fn` once it is this arrival's turn. Throws `QueueFullError`
   * synchronously (before any await) when the queue is full so the caller
   * can answer 503 without having touched the engine.
   */
  run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.full) throw new QueueFullError(this.estimateWaitMs())
    return this.admit(fn)
  }

  private async admit<T>(fn: () => Promise<T>): Promise<T> {
    if (this.running) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve)
      })
    }
    // Either nothing was running, or the previous run handed the slot to us
    // without ever releasing it (see `finally` below) — no gap in between.
    this.running = true
    const started = this.now()
    try {
      return await fn()
    } finally {
      this.record(this.now() - started)
      const next = this.waiters.shift()
      if (next) {
        // Hand over while `running` stays true so an arrival in the same
        // tick cannot slip in ahead of the waiter.
        next()
      } else {
        this.running = false
      }
    }
  }

  private record(ms: number): void {
    const sample = Math.max(0, ms)
    this.averageMs =
      this.averageMs === null ? sample : this.averageMs + EMA_ALPHA * (sample - this.averageMs)
  }
}
