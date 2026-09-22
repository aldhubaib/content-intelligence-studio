// CI: render sidecar request parsing + font cache (Track E3c Part E).
import { describe, expect, test } from 'bun:test'

import { FontCache, sha256Hex } from '#studio-render/font-cache'
import { fontReadinessProblem, parseRenderRequest } from '#studio-render/protocol'

const HASH = 'a'.repeat(64)

describe('parseRenderRequest', () => {
  test('accepts the minimal request and fills defaults', () => {
    const parsed = parseRenderRequest({ document: { documentFormat: 'openpencil-scene-graph' } })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.request.format).toBe('png')
    expect(parsed.request.scale).toBe(1)
    expect(parsed.request.fonts).toEqual([])
    expect(parsed.request.fontPolicy).toBe('strict')
  })

  test('accepts fonts, frameId, mode and policy', () => {
    const parsed = parseRenderRequest({
      document: {},
      frameId: '1:2',
      format: 'png',
      scale: 2,
      mode: 'supersample',
      fontPolicy: 'warn',
      fonts: [{ family: 'IBM Plex Sans Arabic', weight: 700, hash: HASH, data: 'AAAA' }]
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.request.frameId).toBe('1:2')
    expect(parsed.request.mode).toBe('supersample')
    expect(parsed.request.fontPolicy).toBe('warn')
    expect(parsed.request.fonts[0]).toEqual({
      family: 'IBM Plex Sans Arabic',
      weight: 700,
      hash: HASH,
      data: 'AAAA'
    })
  })

  test.each([
    [null, 'JSON object'],
    [{}, '`document`'],
    [{ document: {}, format: 'jpg' }, '`format`'],
    [{ document: {}, scale: 0 }, '`scale`'],
    [{ document: {}, scale: 100 }, '`scale`'],
    [{ document: {}, frameId: '' }, '`frameId`'],
    [{ document: {}, mode: 'fast' }, '`mode`'],
    [{ document: {}, fontPolicy: 'allow' }, '`fontPolicy`'],
    [{ document: {}, fonts: {} }, '`fonts`'],
    [{ document: {}, fonts: [{ family: '', weight: 400, hash: HASH }] }, 'family'],
    [{ document: {}, fonts: [{ family: 'X', weight: 500, hash: HASH }] }, 'weight'],
    [{ document: {}, fonts: [{ family: 'X', weight: 400, hash: 'nope' }] }, 'hash'],
    [{ document: {}, fonts: [{ family: 'X', weight: 400, hash: HASH, data: 1 }] }, 'data']
  ])('rejects %p', (body, fragment) => {
    const parsed = parseRenderRequest(body)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.message).toContain(fragment)
  })
})

describe('fontReadinessProblem', () => {
  test('null when every text node is ready', () => {
    expect(fontReadinessProblem({ a: 'ready', b: 'ready' }, [])).toBeNull()
  })

  test('names the node, the reason and the missing faces', () => {
    const problem = fontReadinessProblem({ 'slot:headline': 'substituted', body: 'pending' }, [
      'Plex Bold (missing)'
    ])
    expect(problem).toContain('“slot:headline” shaped with a fallback font')
    expect(problem).toContain('“body” still waiting for its font')
    expect(problem).toContain('Missing faces: Plex Bold (missing).')
  })
})

describe('FontCache', () => {
  const bytesA = new Uint8Array([1, 2, 3, 4]).buffer
  const bytesB = new Uint8Array([9, 9, 9, 9, 9, 9]).buffer
  const b64 = (buffer: ArrayBuffer) => Buffer.from(buffer).toString('base64')

  test('reports unknown hashes as missing without data', async () => {
    const cache = new FontCache(1024)
    const hash = await sha256Hex(bytesA)
    const result = await cache.resolve([{ family: 'A', weight: 400, hash }])
    expect(result).toEqual({ ok: false, reason: 'missing', missing: [hash] })
  })

  test('admits verified bytes and serves them from the cache afterwards', async () => {
    const cache = new FontCache(1024)
    const hash = await sha256Hex(bytesA)
    const first = await cache.resolve([{ family: 'A', weight: 400, hash, data: b64(bytesA) }])
    expect(first.ok).toBe(true)
    expect(cache.size).toBe(1)
    const second = await cache.resolve([{ family: 'Renamed', weight: 700, hash }])
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.fonts[0].family).toBe('Renamed')
    expect(second.fonts[0].weight).toBe(700)
    expect(new Uint8Array(second.fonts[0].data)).toEqual(new Uint8Array(bytesA))
  })

  test('refuses bytes whose digest does not match the declared hash', async () => {
    const cache = new FontCache(1024)
    const hash = await sha256Hex(bytesA)
    const result = await cache.resolve([{ family: 'A', weight: 400, hash, data: b64(bytesB) }])
    expect(result).toEqual({ ok: false, reason: 'hash_mismatch', hash })
    expect(cache.size).toBe(0)
  })

  test('refuses invalid base64', async () => {
    const cache = new FontCache(1024)
    const hash = await sha256Hex(bytesA)
    const result = await cache.resolve([{ family: 'A', weight: 400, hash, data: '@@not-base64@@' }])
    expect(result).toEqual({ ok: false, reason: 'bad_base64', hash })
  })

  test('evicts least recently used bytes past the cap but keeps the newest entry', async () => {
    const cache = new FontCache(8)
    const hashA = await sha256Hex(bytesA)
    const hashB = await sha256Hex(bytesB)
    await cache.resolve([{ family: 'A', weight: 400, hash: hashA, data: b64(bytesA) }])
    await cache.resolve([{ family: 'B', weight: 400, hash: hashB, data: b64(bytesB) }])
    expect(cache.has(hashA)).toBe(false)
    expect(cache.has(hashB)).toBe(true)
    expect(cache.byteLength).toBe(6)
  })
})
