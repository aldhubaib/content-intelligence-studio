// CI: Track E3d-c — a design's OWN copy in the hosted Studio (`?kind=design`):
// the post's words are painted as fixed content and cannot be edited, the name
// is read-only, there is no autosave, and Save version births a NEW design row
// the session moves to. The template specs (`hosted.spec.ts`,
// `hosted-preview.spec.ts`) are untouched by design mode.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  DESIGN_CONTENT,
  DESIGN_ID,
  DESIGN_NAME,
  FRAME_ID,
  installDesignAPI,
  type SavedBody
} from './hosted-api'

const TITLE_ID = '0:5'

test.describe('hosted mode — a design’s own copy', () => {
  test('E3d-c: opens the design, locks the post’s text, saves a new version and moves to it', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installDesignAPI(page, saves)
    const canvas = new CanvasHelper(page)
    const titleText = () =>
      page.evaluate(
        (id) => window.openPencil?.getStore?.()?.graph.getNode(id)?.text ?? null,
        TITLE_ID
      )
    await page.goto(`/?doc=${DESIGN_ID}&kind=design&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')

    // Read-only name from the app, no Draft mark, the fixed-content words instead of Preview with ▾.
    await expect(page).toHaveTitle(`${DESIGN_NAME} · Content Intelligence Studio`)
    await expect(page.getByTestId('ci-content-fixed')).toHaveText('Content from the post')
    await expect(page.getByTestId('ci-preview-menu')).toHaveCount(0)
    await expect(page.getByTestId('ci-title-draft')).toHaveCount(0)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v2')

    // The post's title is painted into `content:title`; the document still holds the placeholder.
    await expect.poll(titleText).toBe(DESIGN_CONTENT.title)
    expect(await page.evaluate(() => window.openPencil?.getStore?.()?.undo.canUndo ?? null)).toBe(
      false
    )

    // File menu: Back to post, never Back to templates / Save as new template.
    await page.getByTestId('menubar-file').click()
    await expect(page.getByRole('menuitem', { name: 'Back to post' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Save version' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Open in new tab' })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: /^Export image/ })).toBeVisible()
    await expect(page.getByRole('menuitem', { name: 'Back to templates' })).toHaveCount(0)
    await expect(page.getByRole('menuitem', { name: 'Save as new template' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // A text write on the locked layer is refused: the layer keeps the post's words, nothing is saved.
    await page.evaluate((id) => {
      const store = window.openPencil?.getStore?.()
      store?.select([id])
      store?.updateNodeWithUndo(id, { text: 'my own words' }, 'Edit text')
    }, TITLE_ID)
    await expect.poll(titleText).toBe(DESIGN_CONTENT.title)
    await expect(
      page.getByText('Text comes from the post — edit the draft on Plan.').first()
    ).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('hosted-design-locked.png') })

    // A layout edit is real: Save version PUTs the placeholder document and the
    // session moves to the NEW design id the app answered.
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 40 })
    }, FRAME_ID)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Unsaved changes')
    await expect(page.getByTestId('ci-bindings-status')).toHaveText(
      'Unsaved changes — Save version (⌘S) keeps them as a new version.'
    )
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0].kind).toBe('version')
    expect(saves[0].baseVersion).toBe(2)
    expect(saves[0].name).toBeUndefined()
    const sent = JSON.stringify(saves[0].document)
    expect(sent).not.toContain(DESIGN_CONTENT.title)
    expect(sent).toContain('عنوان تجريبي')
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    await expect(page).toHaveTitle('Rent prices · LinkedIn Post · v3 · Content Intelligence Studio')
    // The post still fills the layer after the move.
    expect(await titleText()).toBe(DESIGN_CONTENT.title)

    // A second save goes to the NEW row (the stub 404s the old id).
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 60 })
    }, FRAME_ID)
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(2)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')
    expect(saves.every((s) => s.kind === 'version')).toBe(true)

    // No autosave in design mode: 35 s of a dirty document write nothing.
    await page.clock.install()
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 80 })
    }, FRAME_ID)
    await page.clock.fastForward(35_000)
    expect(saves.length).toBe(2)
    canvas.assertNoErrors()
  })
})
