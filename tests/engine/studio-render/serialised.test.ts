// CI: renders are serialised — one in flight, a bounded queue, 503 render_busy, /healthz/render (S-11, INC-18).
import { describe, expect, test } from 'bun:test'

import type { RenderHealthBody, SidecarHealthBody } from '#studio-render/protocol'
import { RenderQueue } from '#studio-render/queue'
import { type SidecarOptions, handleRequest } from '#studio-render/server'

import {
  SECRET,
  bodyOf,
  controlledRender,
  deferred,
  fakeLifecycle,
  fakeReport,
  options,
  post,
  renderBody,
  settle
} from './helpers'

const renderHealth = async (opts: SidecarOptions, url = 'http://sidecar/healthz/render') =>
  (await (await handleRequest(new Request(url), opts)).json()) as RenderHealthBody

describe('handleRequest — serialised renders (S-11)', () => {
  test('two concurrent renders: the second waits for the first and both succeed in order', async () => {
    const { render, started, releaseNext } = controlledRender()
    const queue = new RenderQueue({ maxWaiting: 8 })
    const opts = options({ render, queue })
    const first = handleRequest(post(renderBody('a')), opts)
    const second = handleRequest(post(renderBody('b')), opts)
    await settle()
    expect(started).toEqual(['a'])
    expect(queue.inFlight).toBe(1)
    expect(queue.waiting).toBe(1)
    releaseNext()
    const a = await first
    expect(a.status).toBe(200)
    expect(a.headers.get('x-render-frame')).toBe('a')
    await settle()
    expect(started).toEqual(['a', 'b'])
    releaseNext()
    const b = await second
    expect(b.status).toBe(200)
    expect(b.headers.get('x-render-frame')).toBe('b')
    expect(queue.inFlight).toBe(0)
    expect(queue.waiting).toBe(0)
  })

  test('queue full → 503 render_busy with retryAfterMs and Retry-After; the engine is never asked', async () => {
    const { render, started, releaseNext } = controlledRender()
    const queue = new RenderQueue({ maxWaiting: 1, assumedMs: 700 })
    const logs: Record<string, unknown>[] = []
    const opts = options({ render, queue, log: (line) => logs.push(line) })
    const first = handleRequest(post(renderBody('a')), opts)
    const second = handleRequest(post(renderBody('b')), opts)
    await settle()
    expect(queue.full).toBe(true)
    const third = await handleRequest(post(renderBody('c')), opts)
    expect(third.status).toBe(503)
    // 1 in flight + 1 waiting at 700 ms each.
    expect(third.headers.get('retry-after')).toBe('2')
    const body = (await third.json()) as { error: string; message: string; retryAfterMs: number }
    expect(body.error).toBe('render_busy')
    expect(body.retryAfterMs).toBe(1400)
    expect(body.message).toContain('1 renders are already waiting')
    expect(started).toEqual(['a'])
    expect(logs.filter((l) => l.event === 'render.busy')).toEqual([
      { event: 'render.busy', waiting: 1, capacity: 1, retryAfterMs: 1400 }
    ])
    releaseNext()
    expect((await first).status).toBe(200)
    await settle()
    releaseNext()
    expect((await second).status).toBe(200)
    // The slot is free again: a new render is accepted.
    const fourth = handleRequest(post(renderBody('d')), opts)
    await settle()
    releaseNext()
    expect((await fourth).status).toBe(200)
    expect(started).toEqual(['a', 'b', 'd'])
  })

  test('a render that queued before the drain began answers 503 render_unavailable instead of rendering', async () => {
    let renders = 0
    const gates: Array<() => void> = []
    const render: SidecarOptions['render'] = async () => {
      const { promise, resolve } = deferred()
      gates.push(resolve)
      await promise
      renders += 1
      return fakeReport()
    }
    const stats: SidecarOptions['stats'] = () => ({ renders, heapBytes: null })
    const { lifecycle, calls } = fakeLifecycle({ maxRenders: 1 })
    const queue = new RenderQueue({ maxWaiting: 8 })
    const opts = options({ render, stats, lifecycle, queue })
    const first = handleRequest(post(renderBody('a')), opts)
    const second = handleRequest(post(renderBody('b')), opts)
    await settle()
    expect(queue.waiting).toBe(1)
    gates.shift()?.()
    expect((await first).status).toBe(200) // the Nth render recycles the process
    expect(lifecycle.draining).toBe(true)
    const b = await second
    expect(b.status).toBe(503)
    expect(await bodyOf(b)).toEqual({
      error: 'render_unavailable',
      message: 'Render unavailable: the renderer is recycling; retry shortly.'
    })
    expect(renders).toBe(1)
    expect(gates).toHaveLength(0)
    await settle()
    expect(calls.exit).toEqual([0])
    // Anything arriving now is refused at the door, before the queue.
    const late = await handleRequest(post(renderBody('c')), opts)
    expect(late.status).toBe(503)
    expect((await bodyOf(late)).error).toBe('render_unavailable')
  })

  test('GET /healthz/render is open and reports the renderer without the bearer', async () => {
    const { render, releaseNext } = controlledRender()
    const queue = new RenderQueue({ maxWaiting: 8 })
    const stats: SidecarOptions['stats'] = () => ({ renders: 12, heapBytes: null })
    const opts = options({ render, queue, stats })
    const idle = await handleRequest(new Request('http://sidecar/healthz/render'), opts)
    expect(idle.status).toBe(200)
    expect(idle.headers.get('cache-control')).toBe('no-store')
    const idleBody = (await idle.json()) as RenderHealthBody
    expect(idleBody).toEqual({
      ok: true,
      renders: 12,
      uptimeSec: idleBody.uptimeSec,
      inFlight: 0,
      waiting: 0
    })
    expect(typeof idleBody.uptimeSec).toBe('number')

    const a = handleRequest(post(renderBody('a')), opts)
    const b = handleRequest(post(renderBody('b')), opts)
    await settle()
    const busy = await renderHealth(opts, 'http://sidecar/internal/healthz/render')
    expect(busy.inFlight).toBe(1)
    expect(busy.waiting).toBe(1)
    releaseNext()
    await a
    await settle()
    releaseNext()
    await b

    expect(
      (await handleRequest(new Request('http://sidecar/healthz/render', { method: 'POST' }), opts))
        .status
    ).toBe(405)
    expect((await renderHealth(options({ secret: null, stats }))).ok).toBe(false)
    const { lifecycle } = fakeLifecycle({ maxRenders: 0 })
    lifecycle.exhausted(12, 'gone')
    expect((await renderHealth(options({ lifecycle, stats }))).ok).toBe(false)

    // The bearer-gated /internal/health carries the queue too.
    const gated = (await (
      await handleRequest(
        new Request('http://sidecar/internal/health', { headers: { authorization: `Bearer ${SECRET}` } }),
        opts
      )
    ).json()) as SidecarHealthBody
    expect(gated.queue).toEqual({ inFlight: 0, waiting: 0, capacity: 8 })
  })
})
