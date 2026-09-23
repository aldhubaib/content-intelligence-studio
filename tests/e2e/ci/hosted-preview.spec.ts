// CI: Track E3d-b1 (FB-44 §6) — **Preview with ▾**: an Approved Arabic candidate
// or the sample text painted into the `content:*` layers of the open template,
// never an edit, never saved, gone on reopen; `?preview=<candidate id>` from the
// app pre-selects; an app without the candidates route reads "Preview unavailable".
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  CANDIDATE,
  FRAME_ID,
  SAMPLE_TEXT,
  TEMPLATE_ID,
  installAPI,
  type SavedBody
} from './hosted-api'

test.describe('hosted mode — preview with real content', () => {
  test('E3d-b1 (FB-44 §6): Preview with ▾ paints a candidate, is not an edit, never saves, and reopens clean', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves)
    const canvas = new CanvasHelper(page)
    const open = async () => {
      await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
      await canvas.waitForInit()
      await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    }
    const titleText = () =>
      page.evaluate(() => window.openPencil?.getStore?.()?.graph.getNode('0:5')?.text ?? null)
    await open()

    // The title row carries the menu, idle: "Preview with", nothing painted yet.
    const menu = page.getByTestId('ci-preview-menu')
    await expect(menu).toHaveAttribute('data-selection', 'none')
    // The words live in the accessible name (the narrow panel shows the eye only).
    await expect(menu).toHaveAccessibleName('Preview with — Preview content, not saved')
    expect(await titleText()).toBe('عنوان تجريبي')

    // Open → the candidates load with the bearer → pick the one Approved candidate.
    await menu.click()
    await expect(page.getByTestId('ci-preview-menu-content')).toBeVisible()
    await expect(page.getByText('Approved Arabic candidates')).toBeVisible()
    const row = page.getByTestId(`ci-preview-candidate-${CANDIDATE.id}`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(CANDIDATE.title)
    await expect(page.getByTestId('ci-preview-sample')).toBeVisible()
    await expect(page.getByTestId('ci-preview-none')).toBeVisible()
    await expect(page.getByTestId('ci-preview-refresh')).toBeVisible()
    await page.screenshot({
      path: test.info().outputPath('hosted-preview-menu.png')
    })
    await row.click()

    // The canvas shows the candidate's title in the `content:title` layer …
    await expect.poll(titleText).toBe(CANDIDATE.title)
    await expect(menu).toHaveAttribute('data-selection', CANDIDATE.id)
    await expect(menu).toHaveAccessibleName(
      `Preview: ${CANDIDATE.title} — Preview content, not saved`
    )
    await expect(menu).toHaveAttribute('data-active', '')
    // … and it is not an edit: still saved, no autosave, no undo entry.
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    expect(await page.evaluate(() => window.openPencil?.getStore?.()?.undo.canUndo ?? null)).toBe(
      false
    )
    await canvas.waitForRender()
    await page.waitForTimeout(300)
    await page.screenshot({
      path: test.info().outputPath('hosted-preview.png')
    })

    // A real edit + Save version while the preview is up: the PUT carries the
    // placeholder, never the candidate's words; the preview outlives the save.
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 40 })
    }, FRAME_ID)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Unsaved changes')
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(1)
    expect(saves[0].kind).toBe('version')
    const sent = JSON.stringify(saves[0].document)
    expect(sent).not.toContain(CANDIDATE.title)
    expect(sent).toContain('عنوان تجريبي')
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')
    expect(await titleText()).toBe(CANDIDATE.title)

    // Sample text and None are the other two rows; None restores the placeholder exactly.
    await menu.click()
    await page.getByTestId('ci-preview-sample').click()
    await expect.poll(titleText).toBe(SAMPLE_TEXT.title)
    await expect(menu).toHaveAccessibleName('Preview: Sample text — Preview content, not saved')
    await menu.click()
    await page.getByTestId('ci-preview-none').click()
    await expect.poll(titleText).toBe('عنوان تجريبي')
    await expect(menu).toHaveAttribute('data-selection', 'none')

    // Reopen: the saved version carries the placeholders, nothing is pre-selected.
    await open()
    expect(await titleText()).toBe('عنوان تجريبي')
    await expect(page.getByTestId('ci-preview-menu')).toHaveAttribute('data-selection', 'none')

    // `?preview=<candidate id>` from the app pre-selects that candidate on open.
    await page.goto(
      `/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}&preview=${CANDIDATE.id}`
    )
    await canvas.waitForInit()
    await expect.poll(titleText).toBe(CANDIDATE.title)
    await expect(page.getByTestId('ci-preview-menu')).toHaveAttribute(
      'data-selection',
      CANDIDATE.id
    )
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')
    canvas.assertNoErrors()
  })

  test('E3d-b1: an app without the candidates route reads "Preview unavailable"', async ({
    page
  }) => {
    await installAPI(page, [], { candidates: null })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    await page.getByTestId('ci-preview-menu').click()
    await expect(page.getByTestId('ci-preview-unavailable')).toBeVisible()
    await expect(page.getByTestId('ci-preview-unavailable')).toContainText('Preview unavailable')
    // Sample text still works without the app's list.
    await page.getByTestId('ci-preview-sample').click()
    await expect
      .poll(() =>
        page.evaluate(() => window.openPencil?.getStore?.()?.graph.getNode('0:5')?.text ?? null)
      )
      .toBe(SAMPLE_TEXT.title)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    // The 404 itself is logged by the browser as a resource error — expected here, so
    // `assertNoErrors` is not asserted for this scenario.
  })
})
