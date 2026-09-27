// CI: the render queue — one in flight, bounded wait, honest estimates (S-11).
import { describe, expect, test } from 'bun:test'

import { QueueFullError, RenderQueue } from '#studio-render/queue'

import { deferred } from './helpers'

/** A render whose completion the test controls. */
function gate() {
  const { promise, resolve } = deferred()
  return { done: promise, release: resolve }
}

const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })

/** A render that finishes at once. */
const instant = async (): Promise<void> => undefined

describe('RenderQueue', () => {
  test('runs one at a time, in arrival order, and hands the slot over without a gap', async () => {
    const queue = new RenderQueue({ maxWaiting: 8 })
    const order: string[] = []
    const first = gate()
    const second = gate()
    const a = queue.run(async () => {
      order.push('a:start')
      await first.done
      order.push('a:end')
      return 'a'
    })
    const b = queue.run(async () => {
      order.push('b:start')
      await second.done
      order.push('b:end')
      return 'b'
    })
    await tick()
    expect(order).toEqual(['a:start'])
    expect(queue.inFlight).toBe(1)
    expect(queue.waiting).toBe(1)
    first.release()
    await tick()
    // b started the moment a finished; a late arrival queues behind b.
    expect(order).toEqual(['a:start', 'a:end', 'b:start'])
    expect(queue.inFlight).toBe(1)
    expect(queue.waiting).toBe(0)
    const c = queue.run(async () => {
      order.push('c')
      return 'c'
    })
    expect(queue.waiting).toBe(1)
    second.release()
    expect(await Promise.all([a, b, c])).toEqual(['a', 'b', 'c'])
    expect(order).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c'])
    expect(queue.inFlight).toBe(0)
    expect(queue.waiting).toBe(0)
  })

  test('refuses synchronously once maxWaiting renders wait, with a wait estimate', async () => {
    let now = 0
    const queue = new RenderQueue({ maxWaiting: 2, assumedMs: 500, now: () => now })
    const running = gate()
    const a = queue.run(async () => {
      await running.done
    })
    const b = queue.run(instant)
    const c = queue.run(instant)
    expect(queue.full).toBe(true)
    expect(queue.waiting).toBe(2)
    // 1 in flight + 2 waiting, 500 ms assumed each → 1 500 ms.
    expect(queue.estimateWaitMs()).toBe(1500)
    let refused: unknown = null
    try {
      void queue.run(instant)
    } catch (error) {
      refused = error
    }
    expect(refused).toBeInstanceOf(QueueFullError)
    expect((refused as QueueFullError).retryAfterMs).toBe(1500)
    expect((refused as QueueFullError).code).toBe('render_busy')
    now = 2000
    running.release()
    await Promise.all([a, b, c])
    expect(queue.full).toBe(false)
  })

  test('maxWaiting 0 refuses whenever a render is in flight, never when idle', async () => {
    const queue = new RenderQueue({ maxWaiting: 0 })
    expect(queue.full).toBe(false)
    const running = gate()
    const a = queue.run(async () => {
      await running.done
    })
    expect(queue.full).toBe(true)
    expect(() => void queue.run(instant)).toThrow(QueueFullError)
    running.release()
    await a
    expect(queue.full).toBe(false)
    await queue.run(instant)
  })

  test('a failed render releases the slot and still counts towards the average', async () => {
    let now = 0
    const queue = new RenderQueue({ maxWaiting: 4, assumedMs: 100, minRetryAfterMs: 0, now: () => now })
    await expect(
      queue.run(async () => {
        now = 800
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(queue.inFlight).toBe(0)
    expect(queue.averageRenderMs).toBe(800)
    // EMA: 800 + 0.3 × (200 − 800) = 620.
    await queue.run(async () => {
      now = 1000
    })
    expect(queue.averageRenderMs).toBe(620)
    expect(queue.estimateWaitMs()).toBe(0)
  })

  test('the estimate never drops below the floor', () => {
    const queue = new RenderQueue({ maxWaiting: 8, assumedMs: 10, minRetryAfterMs: 1000 })
    expect(queue.estimateWaitMs()).toBe(1000)
  })
})
