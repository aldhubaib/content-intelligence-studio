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

async function installAPI(page: Page, saves: SavedBody[]) {
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
            ai: { enabled: false }
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

    // The document name is the template's name.
    const name = await page.evaluate(
      () => window.openPencil?.getStore?.()?.state.documentName ?? null
    )
    expect(name).toBe('Smoke portrait')

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

  test('standalone boot (no ?doc) is untouched', async ({ page }) => {
    const canvas = new CanvasHelper(page)
    await page.goto('/')
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-slots-panel')).toHaveCount(0)
    await expect(page.getByTestId('canvas-element')).toBeVisible()
  })
})
