// CI: the hosted editor's emoji fallback face (PATCHES H-71) — the loader
// registers the bundled face and appends it as the last paragraph family; a
// failed fetch is one log line and nothing registered; the constants are the
// sidecar's (H-69) so the editor and the render shape emoji with the same face.
import { describe, expect, test } from 'bun:test'

import {
  EMOJI_FALLBACK_FAMILY as SIDECAR_FAMILY,
  EMOJI_FALLBACK_FONT_FILE as SIDECAR_FILE,
  EMOJI_FALLBACK_STYLE as SIDECAR_STYLE
} from '#studio-render/emoji-face'

import {
  EMOJI_FALLBACK_FAMILY,
  EMOJI_FALLBACK_STYLE,
  EMOJI_FACE_ASSET_URL,
  EMOJI_FACE_LOG,
  installEmojiFace,
  redrawTextForEmojiFace,
  type EmojiFaceFonts
} from '@/app/ci/emoji-face'

/** A font manager that records the three calls the loader may make. */
function fakeFonts(loaded = false) {
  const calls: Array<{ method: string; args: unknown[] }> = []
  const fonts: EmojiFaceFonts = {
    isStyleLoaded: (family, style) => {
      calls.push({ method: 'isStyleLoaded', args: [family, style] })
      return loaded
    },
    markLoaded: (family, style, data, source) => {
      calls.push({ method: 'markLoaded', args: [family, style, data.byteLength, source] })
    },
    setCJKFallbackFamily: (family) => {
      calls.push({ method: 'setCJKFallbackFamily', args: [family] })
    }
  }
  return { fonts, calls }
}

const BYTES = new Uint8Array([0x77, 0x4f, 0x46, 0x46, 1, 2, 3, 4]) // "wOFF" + payload

function answering(status: number, body: Uint8Array | null = BYTES): typeof fetch {
  return (async (input: string | URL | Request) =>
    new Response(body ? new Uint8Array(body) : null, {
      status,
      headers: { 'content-type': 'font/woff', 'x-url': String(input) }
    })) as typeof fetch
}

describe('emoji face — constants', () => {
  test('the browser twin registers exactly what the render sidecar registers (H-69)', () => {
    expect(EMOJI_FALLBACK_FAMILY).toBe(SIDECAR_FAMILY)
    expect(EMOJI_FALLBACK_STYLE).toBe(SIDECAR_STYLE)
    // The Vite asset is the sidecar's file — the same WOFF, never a CDN.
    expect(EMOJI_FACE_ASSET_URL).toContain('noto-color-emoji-emoji-400-normal')
    expect(SIDECAR_FILE.endsWith('noto-color-emoji-emoji-400-normal.woff')).toBe(true)
    expect(EMOJI_FACE_ASSET_URL).not.toMatch(/^https?:\/\//)
  })
})

describe('emoji face — installEmojiFace', () => {
  test('bytes answered → the face is registered under the family and becomes the CJK (last) fallback; one log line', async () => {
    const { fonts, calls } = fakeFonts()
    const lines: string[] = []
    const fetched: string[] = []
    const result = await installEmojiFace({
      url: '/assets/noto-color-emoji-abc123.woff',
      fetch: (async (input: string | URL | Request, init?: RequestInit) => {
        fetched.push(String(input))
        expect(init?.headers).toBeUndefined() // same origin: no bearer, no app header
        return answering(200)(input)
      }) as typeof fetch,
      fonts,
      log: (line) => lines.push(line)
    })
    expect(result).toEqual({
      registered: true,
      family: EMOJI_FALLBACK_FAMILY,
      style: EMOJI_FALLBACK_STYLE,
      bytes: BYTES.byteLength,
      alreadyLoaded: false
    })
    expect(fetched).toEqual(['/assets/noto-color-emoji-abc123.woff'])
    expect(calls).toEqual([
      { method: 'isStyleLoaded', args: [EMOJI_FALLBACK_FAMILY, EMOJI_FALLBACK_STYLE] },
      {
        method: 'markLoaded',
        args: [EMOJI_FALLBACK_FAMILY, EMOJI_FALLBACK_STYLE, BYTES.byteLength, 'registered']
      },
      { method: 'setCJKFallbackFamily', args: [EMOJI_FALLBACK_FAMILY] }
    ])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith(EMOJI_FACE_LOG.registered)
    expect(lines[0]).toContain(`${BYTES.byteLength} bytes`)
  })

  test('a failed fetch (HTTP error) registers nothing, logs emoji-face-missing once and never throws', async () => {
    const { fonts, calls } = fakeFonts()
    const lines: string[] = []
    const result = await installEmojiFace({
      url: '/assets/gone.woff',
      fetch: answering(404, null),
      fonts,
      log: (line) => lines.push(line)
    })
    expect(result.registered).toBe(false)
    if (result.registered) throw new Error('unreachable')
    expect(result.message).toContain('404')
    expect(calls.map((c) => c.method)).toEqual(['isStyleLoaded'])
    expect(lines).toHaveLength(1)
    expect(lines[0]).toStartWith(EMOJI_FACE_LOG.missing)
  })

  test('a network failure and an empty body are the same outcome — nothing registered, one line', async () => {
    const offline = fakeFonts()
    const offlineLines: string[] = []
    const network = await installEmojiFace({
      url: '/assets/x.woff',
      fetch: (async () => {
        throw new TypeError('Failed to fetch')
      }) as typeof fetch,
      fonts: offline.fonts,
      log: (line) => offlineLines.push(line)
    })
    expect(network.registered).toBe(false)
    expect(offline.calls.map((c) => c.method)).toEqual(['isStyleLoaded'])
    expect(offlineLines).toEqual([
      `${EMOJI_FACE_LOG.missing} ${EMOJI_FALLBACK_FAMILY} ${EMOJI_FALLBACK_STYLE}: Failed to fetch`
    ])

    const empty = fakeFonts()
    const emptyLines: string[] = []
    const result = await installEmojiFace({
      url: '/assets/x.woff',
      fetch: answering(200, new Uint8Array()),
      fonts: empty.fonts,
      log: (line) => emptyLines.push(line)
    })
    expect(result.registered).toBe(false)
    expect(empty.calls.map((c) => c.method)).toEqual(['isStyleLoaded'])
    expect(emptyLines).toHaveLength(1)
    expect(emptyLines[0]).toContain('empty response')
  })

  test('a face already in the manager is not fetched again — the chain is (re)pointed and the result says so', async () => {
    const { fonts, calls } = fakeFonts(true)
    const lines: string[] = []
    let fetches = 0
    const result = await installEmojiFace({
      url: '/assets/x.woff',
      fetch: (async () => {
        fetches++
        return new Response(BYTES)
      }) as typeof fetch,
      fonts,
      log: (line) => lines.push(line)
    })
    expect(result).toMatchObject({ registered: true, alreadyLoaded: true, bytes: 0 })
    expect(fetches).toBe(0)
    expect(calls.map((c) => c.method)).toEqual(['isStyleLoaded', 'setCJKFallbackFamily'])
    expect(lines).toEqual([])
  })

  test('the abort signal reaches the fetch', async () => {
    const { fonts } = fakeFonts()
    const controller = new AbortController()
    let seen: AbortSignal | null | undefined
    await installEmojiFace({
      url: '/assets/x.woff',
      fetch: (async (_input: string | URL | Request, init?: RequestInit) => {
        seen = init?.signal
        return new Response(BYTES)
      }) as typeof fetch,
      fonts,
      signal: controller.signal,
      log: () => undefined
    })
    expect(seen).toBe(controller.signal)
  })
})

describe('emoji face — redrawTextForEmojiFace', () => {
  test('every distinct canvas syncs its font generation and drops its pictures, then ONE render is requested', () => {
    const order: string[] = []
    const renderer = (name: string) => ({
      syncFontGeneration: () => order.push(`${name}:sync`),
      invalidateAllPictures: () => order.push(`${name}:invalidate`)
    })
    const main = renderer('main')
    const second = renderer('second')
    let renders = 0
    // `store.renderer` is also the first of `store.canvasRenderers` — touched once.
    const touched = redrawTextForEmojiFace([main, null, main, second, undefined], () => renders++)
    expect(touched).toBe(2)
    expect(order).toEqual(['main:sync', 'main:invalidate', 'second:sync', 'second:invalidate'])
    expect(renders).toBe(1)
  })

  test('no canvas yet (unit-test store) → still one render request, nothing thrown', () => {
    let renders = 0
    expect(redrawTextForEmojiFace([null], () => renders++)).toBe(0)
    expect(renders).toBe(1)
  })
})
