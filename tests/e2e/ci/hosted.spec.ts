// CI: hosted-mode smoke (ADR-058 §8, Track E3c Part B; Track E3d-a FB-44 /
// FB-45 — binding model v3 + native chrome).
//
// The Studio boots with `?doc=…&ws=…&token=…&api=…`, the app API is answered by
// Playwright's route interception, and we assert the seams that matter: the
// template opens, the Bindings panel reads it, ⌘S PUTs a `version` and the
// title's save state follows, the File menu leads back (asking once when
// dirty), a legacy `slot:` template is migrated on open, and the token never
// survives in the address bar.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  CAROUSEL,
  FRAME_ID,
  TEMPLATE_ID,
  TEMPLATES_URL,
  installAPI,
  installAppPages,
  type SavedBody
} from './hosted-api'

test.describe('hosted mode', () => {
  test('opens the template from the app API, reads its bindings and saves a version on ⌘S', async ({
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

    const status = page.getByTestId('ci-bindings-status')
    await expect(status).toHaveText('All changes saved.')
    // FB-44 §3: the Bindings panel — cover OK with its two layers, repeat / ending not added.
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-usable', 'true')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveText('Usable')
    await expect(page.getByTestId('ci-role-cover')).toHaveAttribute('data-status', 'ok')
    await expect(page.getByTestId('ci-role-words-cover')).toHaveText('OK')
    await expect(page.getByTestId('ci-binding-cover-content:title')).toBeVisible()
    await expect(page.getByTestId('ci-binding-cover-content:image')).toBeVisible()
    await expect(page.getByTestId('ci-role-words-repeat')).toHaveText('not added')
    await expect(page.getByTestId('ci-role-words-ending')).toHaveText('not added')
    // FB-45: native chrome — no tab bar, the menu bar is the first row, the title
    // carries the read-only format line and OpenPencil's save state.
    await expect(page.getByTestId('tabbar-tab')).toHaveCount(0)
    // The format line is read-only in the title bar; it hides in a panel narrower than 300 px.
    await expect(page.getByTestId('ci-title-format')).toHaveAttribute(
      'data-format',
      'Instagram post · 1080 × 1350'
    )
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    await expect(page.getByTestId('ci-title-draft')).toHaveCount(0)
    // Focus lands in the Studio on load.
    expect(
      await page.evaluate(() => document.activeElement?.getAttribute('data-test-id') ?? null)
    ).toBe('canvas-element')

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
      store.updateNode(frameId, { x: 40 })
    }, FRAME_ID)
    await expect(status).toHaveText('Unsaved changes — autosaves every 30 s.')
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Unsaved changes')

    // … and ⌘S saves a version through the app, not the file system; the title bumps vN.
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0].kind).toBe('version')
    expect(saves[0].baseVersion).toBe(3)
    expect(saves[0].name).toBe('Smoke portrait')
    expect((saves[0].document as { documentFormat: string }).documentFormat).toBe(
      'openpencil-scene-graph'
    )
    await expect(status).toHaveText('All changes saved.')
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')

    // File › Save version is the same command, from the menu.
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 80 })
    }, FRAME_ID)
    await page.getByTestId('menubar-file').click()
    await expect(page.getByRole('menuitem', { name: 'Back to templates' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Save as new template' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Export image/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^New\b/ })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /^Save As/ })).toHaveCount(0)
    await page.getByRole('menuitem', { name: 'Save version' }).click()
    await expect.poll(() => saves.length).toBe(2)
    expect(saves[1].kind).toBe('version')
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v5')

    // The host was told about every transition.
    canvas.assertNoErrors()
  })

  test('Part F: with AI on, the panel is pinned to Content Intelligence and the light switch is Gray 10', async ({
    page
  }) => {
    await installAPI(page, [], {
      ai: { enabled: true, models: [{ id: 'gpt-4o', label: 'GPT-4o' }] }
    })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')

    // The AI tab exists, opens straight into the composer (no "connect a provider"
    // placeholder, no key field) and the one model is the pinned one.
    const aiTab = page.getByTestId('properties-tab-ai')
    await expect(aiTab).toBeVisible()
    await aiTab.click()
    await expect(page.getByTestId('provider-setup')).toHaveCount(0)
    await expect(page.getByText('Content Intelligence · GPT-4o').first()).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('hosted-ai-g100.png')
    })

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
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
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

  test('FB-44: Add role frame → rename a layer content:title → the Bindings panel says OK', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves, { format: CAROUSEL })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    // A carousel format: the cover alone is not enough.
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-carousel', 'false')
    await expect(page.getByTestId('ci-role-words-repeat')).toHaveText('not added')

    // Add role frame ▾ → Repeat: a frame named `repeat` at the format size, to the right.
    await page.getByTestId('ci-add-role-frame').first().click()
    await page.getByTestId('ci-add-role-repeat').click()
    await expect(page.getByTestId('ci-role-repeat')).toHaveAttribute('data-present', 'true')
    await expect(page.getByTestId('ci-role-words-repeat')).toHaveText('repeat has no content:body')
    const repeat = await page.evaluate(() => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      const frame = store.graph
        .getChildren(store.state.currentPageId)
        .find((n) => n.type === 'FRAME' && n.name === 'repeat')
      if (!frame) throw new Error('repeat frame missing')
      return {
        id: frame.id,
        x: frame.x,
        width: frame.width,
        height: frame.height
      }
    })
    expect([repeat.width, repeat.height]).toEqual([1080, 1350])
    expect(repeat.x).toBeGreaterThanOrEqual(1080 + 120)
    // The role now exists: the menu entry is disabled.
    await page.getByTestId('ci-add-role-frame').first().click()
    await expect(page.getByTestId('ci-add-role-repeat')).toHaveAttribute('data-disabled', '')
    await page.keyboard.press('Escape')

    // A text layer renamed `content:body` inside it → Repeat · OK, carousel usable.
    await page.evaluate((frameId) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      const id = store.createShape('TEXT', 40, 40, 800, 200, frameId, 'Body copy')
      store.updateNode(id, { name: 'content:body' })
    }, repeat.id)
    await expect(page.getByTestId('ci-role-words-repeat')).toHaveText('OK')
    await expect(page.getByTestId('ci-binding-repeat-content:body')).toBeVisible()
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-carousel', 'true')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveText('Usable')
    await page.screenshot({
      path: test.info().outputPath('hosted-bindings.png')
    })
    canvas.assertNoErrors()
  })

  test('FB-44 §2: a legacy slot: template is migrated on open and left unsaved', async ({
    page
  }) => {
    await installAPI(page, [], { fixture: 'hosted-template-legacy' })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText(
      'Unsaved changes — autosaves every 30 s.'
    )
    const names = await page.evaluate(() =>
      [...(window.openPencil?.getStore?.()?.graph.getAllNodes() ?? [])].map((n) => n.name)
    )
    expect(names).toEqual(expect.arrayContaining(['cover', 'content:image', 'content:title']))
    expect(names).not.toContain('slot:cover')
    await expect(page.getByTestId('ci-role-words-cover')).toHaveText('OK')
    canvas.assertNoErrors()
  })

  test('FB-45: Back to templates leaves at once when clean and asks once when dirty', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves)
    // Registered last so it wins over the API catch-all for this one path.
    await installAppPages(page)
    const canvas = new CanvasHelper(page)
    const open = async () => {
      await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
      await canvas.waitForInit()
      await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    }
    await open()

    // Dirty → the upstream unsaved-changes dialog, once.
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 40 })
    }, FRAME_ID)
    await page.getByTestId('menubar-file').click()
    await page.getByRole('menuitem', { name: 'Back to templates' }).click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(dialog).toBeVisible()
    await expect(dialog).toContainText('Smoke portrait')
    await dialog.getByRole('button', { name: /cancel/i }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByTestId('canvas-element')).toBeVisible()
    expect(new URL(page.url()).pathname).toBe('/')

    // Save from the dialog = Save version, then leave.
    await page.getByTestId('menubar-file').click()
    await page.getByRole('menuitem', { name: 'Back to templates' }).click()
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^save$/i }).click()
    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0].kind).toBe('version')
    await page.waitForURL(`${TEMPLATES_URL}**`)
    await expect(page.locator('[data-app-page="templates"]')).toBeVisible()

    // Clean → straight out, no dialog.
    await open()
    await page.getByTestId('menubar-file').click()
    await page.getByRole('menuitem', { name: 'Back to templates' }).click()
    await page.waitForURL(`${TEMPLATES_URL}**`)
    await expect(page.locator('[data-app-page="templates"]')).toBeVisible()
  })

  test('standalone boot (no ?doc) is untouched', async ({ page }) => {
    const canvas = new CanvasHelper(page)
    await page.goto('/')
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-panel')).toHaveCount(0)
    await expect(page.getByTestId('ci-title-meta')).toHaveCount(0)
    await page.getByTestId('menubar-file').click()
    await expect(page.getByRole('menuitem', { name: 'Back to templates' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: /^New\b/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('canvas-element')).toBeVisible()
    await expect(page.locator('html')).not.toHaveAttribute('data-palette', /.+/)
    await expect(page.getByTestId('tabbar-new')).toBeVisible()
    await expect(page.getByTestId('properties-tab-ai')).toBeVisible()
    // Upstream keeps its local recovery preference (E3c.1 hides it hosted only).
    await page.getByTestId('app-settings-trigger').click()
    await expect(page.getByTestId('settings-recovery-enabled')).toBeVisible()
  })
})
