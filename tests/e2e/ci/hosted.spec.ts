// CI: hosted-mode smoke (ADR-058 §8, Track E3c Part B).
//
// The Studio boots with `?doc=…&ws=…&token=…&api=…`, the app API is answered by
// Playwright's route interception, and we assert the four seams that matter:
// the template opens, the Slots panel reads it, ⌘S PUTs a `version`, and the
// token never survives in the address bar.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { expect, test, type Page, type Route } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

const API = 'https://app.ci.test'
const TEMPLATE_ID = 'tpl-hosted-smoke'
/** The `Portrait` frame inside `tests/fixtures/ci/hosted-template.json`. */
const FRAME_ID = '0:3'

type SavedBody = { kind: string; baseVersion: number; name?: string; document: unknown }

// Written by `serializeGraph` (src/app/ci/document.ts): one 1080×1350 frame with a
// `slot:cover` rectangle and an Arabic `slot:headline` text layer.
function templateDocument(): unknown {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, '../../fixtures/ci/hosted-template.json'), 'utf8')
  )
}

type AIBlock = { enabled: boolean; models?: Array<{ id: string; label: string }> }

async function installAPI(page: Page, saves: SavedBody[], ai: AIBlock = { enabled: false }) {
  let version = 3
  await page.route(`${API}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === `/api/studio/templates/${TEMPLATE_ID}`) {
      if (request.headers()['authorization'] !== 'Bearer smoke-token') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      if (request.method() === 'GET') {
        return route.fulfill({
          json: {
            document: templateDocument(),
            name: 'Smoke portrait',
            version,
            updatedAt: '2026-09-22T10:00:00Z',
            brand: null,
            fonts: [],
            requiredSlots: ['headline', 'cover', 'body'],
            ai
          }
        })
      }
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as SavedBody
        saves.push(body)
        version += 1
        return route.fulfill({ json: { version, updatedAt: '2026-09-22T10:01:00Z' } })
      }
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
}

test.describe('hosted mode', () => {
  test('opens the template from the app API, lists slots and saves a version on ⌘S', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves)
    const canvas = new CanvasHelper(page)

    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()

    // The token is scrubbed from the address bar as soon as the page boots.
    await expect
      .poll(() => page.evaluate(() => new URL(location.href).searchParams.get('token')))
      .toBeNull()
    expect(await page.evaluate(() => new URL(location.href).searchParams.get('doc'))).toBe(
      TEMPLATE_ID
    )

    const status = page.getByTestId('ci-slots-status')
    await expect(status).toHaveText('All changes saved.')
    await expect(page.getByTestId('ci-slots-missing')).toContainText('slot:body')
    await expect(page.getByTestId('ci-slot-jump-headline')).toHaveText(/slot:headline/)
    await expect(page.getByTestId('ci-slot-jump-cover')).toHaveText(/slot:cover/)
    await expect(page.getByTestId('ci-slot-body')).toHaveAttribute('data-missing', 'true')

    // Visual artefact for the review: frame, cover and the Arabic headline painted
    // with the bundled Noto Naskh Arabic fallback (no CDN in hosted mode).
    await canvas.waitForRender()
    await page.waitForTimeout(500)
    await page.screenshot({ path: test.info().outputPath('hosted-open.png') })

    // The document name is the template's name — and so is the window title (Part F).
    const name = await page.evaluate(
      () => window.openPencil?.getStore?.()?.state.documentName ?? null
    )
    expect(name).toBe('Smoke portrait')
    await expect(page).toHaveTitle('Smoke portrait · Content Intelligence Studio')

    // Part F: Carbon Gray 100 over upstream's dark theme, IBM Plex, no radius; the
    // app owns the document (no new / close tab); AI is off for this workspace, so
    // there is no AI tab and Settings has no provider section.
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'carbon-g100')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim()
      )
    ).toBe('#161616')
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(
      /IBM Plex Sans/
    )
    await expect(page.getByTestId('tabbar-new')).toHaveCount(0)
    await expect(page.getByTestId('tabbar-close')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Share' })).toHaveCount(0)
    await expect(page.getByTestId('properties-tab-ai')).toHaveCount(0)
    await expect(page.getByTestId('properties-tab-design')).toBeVisible()

    // E3c.1 Part B: the 4:5 frame is fitted to the canvas on open — zoomed out,
    // fully inside the viewport — instead of a corner at 100 %.
    const fit = await page.evaluate((frameId) => {
      const store = window.openPencil?.getStore?.()
      const frame = store?.graph.getNode(frameId)
      const canvas = document.querySelector('[data-test-id="canvas-element"]')
      if (!store || !frame || !canvas) throw new Error('store, frame or canvas missing')
      const { zoom, panX, panY } = store.state
      return {
        zoom,
        left: panX + frame.x * zoom,
        top: panY + frame.y * zoom,
        right: panX + (frame.x + frame.width) * zoom,
        bottom: panY + (frame.y + frame.height) * zoom,
        width: canvas.clientWidth,
        height: canvas.clientHeight
      }
    }, FRAME_ID)
    expect(fit.zoom).toBeLessThan(1)
    expect(fit.left).toBeGreaterThanOrEqual(0)
    expect(fit.top).toBeGreaterThanOrEqual(0)
    expect(fit.right).toBeLessThanOrEqual(fit.width + 1)
    expect(fit.bottom).toBeLessThanOrEqual(fit.height + 1)

    // E3c.1 Part A: no browser-local recovery — no "Recover unsaved work" dialog,
    // the runtime override is off and Settings has no "Preserve unsaved work" row.
    await expect(page.getByTestId('recovery-dialog')).toHaveCount(0)
    await page.getByTestId('app-settings-trigger').click()
    await expect(page.getByTestId('app-settings-dialog')).toBeVisible()
    await expect(page.getByTestId('settings-snap-geometry')).toBeVisible()
    await expect(page.getByTestId('settings-recovery-enabled')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('app-settings-dialog')).toHaveCount(0)

    // An edit makes the session dirty …
    await page.evaluate((frameId) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      store.updateNode(frameId, { name: 'Portrait (edited)' })
    }, FRAME_ID)
    await expect(status).toHaveText('Unsaved changes — autosaves every 30 s.')

    // … and ⌘S saves a version through the app, not the file system.
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0].kind).toBe('version')
    expect(saves[0].baseVersion).toBe(3)
    expect(saves[0].name).toBe('Smoke portrait')
    expect((saves[0].document as { documentFormat: string }).documentFormat).toBe(
      'openpencil-scene-graph'
    )
    await expect(status).toHaveText('All changes saved.')

    // The host was told about every transition.
    canvas.assertNoErrors()
  })

  test('Part F: with AI on, the panel is pinned to Content Intelligence and the light switch is Gray 10', async ({
    page
  }) => {
    await installAPI(page, [], { enabled: true, models: [{ id: 'gpt-4o', label: 'GPT-4o' }] })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-slots-status')).toHaveText('All changes saved.')

    // The AI tab exists, opens straight into the composer (no "connect a provider"
    // placeholder, no key field) and the one model is the pinned one.
    const aiTab = page.getByTestId('properties-tab-ai')
    await expect(aiTab).toBeVisible()
    await aiTab.click()
    await expect(page.getByTestId('provider-setup')).toHaveCount(0)
    await expect(page.getByText('Content Intelligence · GPT-4o').first()).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('hosted-ai-g100.png') })

    // Their theme switch: Light → Carbon Gray 10 (own storage key), Dark → Gray 100.
    // Seeded the way the upstream theme tests do it (`storageState`), then a fresh
    // boot — a plain reload has no token any more; the host re-mints one on a new src.
    await page.context().addInitScript(() => {
      // oxlint-disable-next-line open-pencil/no-direct-storage-access
      localStorage.setItem('content-intelligence:studio-theme', 'light')
    })
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.locator('html')).toHaveAttribute('data-palette', 'carbon-g10')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim()
      )
    ).toBe('#f4f4f4')
    await expect(page.getByTestId('ci-slots-status')).toHaveText('All changes saved.')
    await page.screenshot({ path: test.info().outputPath('hosted-g10.png') })
    // Upstream's own preference was never touched.
    expect(
      await page.evaluate(() => {
        // oxlint-disable-next-line open-pencil/no-direct-storage-access
        return localStorage.getItem('open-pencil:theme')
      })
    ).toBeNull()
    canvas.assertNoErrors()
  })

  test('standalone boot (no ?doc) is untouched', async ({ page }) => {
    const canvas = new CanvasHelper(page)
    await page.goto('/')
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-slots-panel')).toHaveCount(0)
    await expect(page.getByTestId('canvas-element')).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-palette', /.+/)
    await expect(page.getByTestId('tabbar-new')).toBeVisible()
    await expect(page.getByTestId('properties-tab-ai')).toBeVisible()
    // Upstream keeps its local recovery preference (E3c.1 hides it hosted only).
    await page.getByTestId('app-settings-trigger').click()
    await expect(page.getByTestId('settings-recovery-enabled')).toBeVisible()
  })
})
