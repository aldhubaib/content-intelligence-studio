// CI: PATCHES H-71 (follow-up of H-69) — the hosted EDITOR canvas registers the
// same bundled Noto Color Emoji face the render sidecar registers, so a layer
// reading `قوة 💪🏼✨` shapes on the canvas exactly as it renders on Plan / Publish.
//
// The face is a content-hashed Vite asset of the Studio's own origin (never the
// app origin, never a CDN), fetched AFTER the brand fonts without holding the
// document; once it lands the boot log says so, the text node is `ready` through
// the engine's readiness API (the same probe the sidecar's report uses) and the
// standalone editor never asks for it.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import { API, TEMPLATE_ID, installAPI, type SavedBody } from './hosted-api'

/** The `content:title` text layer inside `tests/fixtures/ci/hosted-template-emoji.json`. */
const TITLE_ID = '0:5'
const TITLE_TEXT = 'قوة 💪🏼✨'
/** The one boot-log line per outcome — `EMOJI_FACE_LOG` in `src/app/ci/emoji-face.ts`. */
const LOG_REGISTERED = '[CI Studio] emoji-face-registered'
const LOG_MISSING = '[CI Studio] emoji-face-missing'
/** The bundled file — `EMOJI_FALLBACK_FONT_FILE` in `studio-render/emoji-face.ts`. */
const ASSET_NAME = 'noto-color-emoji-emoji-400-normal'

/**
 * A REAL fetch of the font bytes. Under the Vite dev server the `?url` import is
 * itself a request — `…/noto-color-emoji-emoji-400-normal.woff?import&url` — but
 * that is Vite's JS module answering with the URL string, not the WOFF; only a
 * request without `import` in its query carries the bytes.
 */
function isFontByteRequest(url: string): boolean {
  if (!url.includes(ASSET_NAME)) return false
  return !new URL(url).searchParams.has('import')
}

type FontReadiness = 'ready' | 'pending' | 'substituted' | 'exhausted'

function readinessOf(page: Parameters<typeof installAPI>[0], nodeId: string) {
  return page.evaluate((id) => {
    const store = window.openPencil?.getStore?.()
    const node = store?.graph.getNode(id)
    const renderer = store?.renderer
    if (!store || !node || !renderer) return 'missing'
    return renderer.nodeFontReadiness(node) as FontReadiness
  }, nodeId)
}

test.describe('hosted mode — emoji face (H-71)', () => {
  test('the bundled face is fetched from the Studio origin after boot, the boot log says so and the emoji title shapes ready', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves, { fixture: 'hosted-template-emoji' })
    const canvas = new CanvasHelper(page)
    const logs: string[] = []
    page.on('console', (message) => logs.push(message.text()))
    const fontRequests: Array<{ url: string; status: number | null; bytes: number }> = []
    page.on('response', async (response) => {
      const url = response.url()
      if (!isFontByteRequest(url)) return
      // A cached / aborted body has no bytes to count; the status still tells.
      const bytes = await response.body().then(
        (body) => body.byteLength,
        () => 0
      )
      fontRequests.push({ url, status: response.status(), bytes })
    })

    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')

    // The layer under test carries the emoji the brand faces cannot shape.
    expect(
      await page.evaluate(
        (id) => window.openPencil?.getStore?.()?.graph.getNode(id)?.text,
        TITLE_ID
      )
    ).toBe(TITLE_TEXT)

    // The boot log names the registered face — one line, never the missing one.
    await expect.poll(() => logs.some((line) => line.startsWith(LOG_REGISTERED))).toBe(true)
    expect(logs.filter((line) => line.startsWith(LOG_REGISTERED))).toHaveLength(1)
    expect(logs.some((line) => line.startsWith(LOG_MISSING))).toBe(false)
    expect(logs.find((line) => line.startsWith(LOG_REGISTERED))).toContain(
      'Noto Color Emoji Regular'
    )

    // The bytes came from THIS origin (the Vite asset), never from the app origin or a CDN.
    await expect.poll(() => fontRequests.length).toBeGreaterThanOrEqual(1)
    const studioOrigin = new URL(page.url()).origin
    for (const request of fontRequests) {
      expect(new URL(request.url).origin).toBe(studioOrigin)
      expect(request.url.startsWith(API)).toBe(false)
      expect(request.status).toBe(200)
    }
    // The full COLRv1 font is several MB — a slice or an empty answer would not be it.
    expect(Math.max(...fontRequests.map((r) => r.bytes))).toBeGreaterThan(1_000_000)

    // The engine's readiness probe: once the face is the last paragraph family the
    // emoji title is `ready` — not `exhausted` (nothing to shape 💪🏼✨ with) and not
    // `substituted` (Inter standing in).
    await canvas.waitForRender()
    await expect.poll(() => readinessOf(page, TITLE_ID), { timeout: 15_000 }).toBe('ready')

    // Registering a font is not an edit: still clean, still v3.
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    expect(saves).toEqual([])

    // Visual artefact for the review: the title painted with colour emoji.
    await canvas.waitForRender()
    await page.waitForTimeout(500)
    await page.screenshot({ path: test.info().outputPath('hosted-emoji.png') })
    canvas.assertNoErrors()
  })

  test('standalone boot (no ?doc) never asks for the emoji face', async ({ page }) => {
    const canvas = new CanvasHelper(page)
    const logs: string[] = []
    page.on('console', (message) => logs.push(message.text()))
    const fontRequests: string[] = []
    page.on('request', (request) => {
      // Only the bytes count — the dev server's `?import&url` module request is not a font fetch.
      if (isFontByteRequest(request.url())) fontRequests.push(request.url())
    })
    await page.goto('/')
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-panel')).toHaveCount(0)
    await canvas.waitForRender()
    await page.waitForTimeout(1_000)
    expect(fontRequests).toEqual([])
    expect(logs.some((line) => line.startsWith(LOG_REGISTERED))).toBe(false)
    expect(logs.some((line) => line.startsWith(LOG_MISSING))).toBe(false)
  })
})
