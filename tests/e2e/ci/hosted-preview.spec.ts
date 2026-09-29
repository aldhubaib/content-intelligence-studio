// CI: Track E3d-b1 (FB-44 §6) — **Preview with ▾**: an Approved Arabic candidate
// or the sample text painted into the `content:*` layers of the open template,
// never an edit, never saved, gone on reopen; `?preview=<candidate id>` from the
// app pre-selects; an app without the candidates route reads "Preview unavailable".
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  BRAND,
  BRAND_TEXT,
  CANDIDATE,
  FRAME_ID,
  GROUP_LABELS,
  KIND_CANDIDATE,
  SAMPLE_TEXT,
  TEMPLATE_ID,
  VOCABULARY_OLDER,
  installAPI,
  openBindings,
  type SavedBody
} from './hosted-api'

/** Track FB-69: the two brand text layers of `tests/fixtures/ci/hosted-template-brand-text.json`. */
const DISPLAY_NAME_ID = '0:6'
const HANDLE_ID = '0:7'

/**
 * Track fb74-studio-preview-kinds (H-70): `tests/fixtures/ci/hosted-template-kinds.json` —
 * cover (title · number · step) · repeat (body · step) · ending (cta · step).
 */
const KINDS = {
  title: '0:5',
  number: '0:6',
  coverStep: '0:7',
  repeatBody: '0:9',
  repeatStep: '0:10',
  endingStep: '0:13'
} as const

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

  test('Track FB-69 (H-68): brand:display-name / brand:handle show the kit’s text on open — never an edit, never saved; selection lifts', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves, { fixture: 'hosted-template-brand-text', brand: BRAND })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    const textOf = (id: string) =>
      page.evaluate(
        (nodeId) => window.openPencil?.getStore?.()?.graph.getNode(nodeId)?.text ?? null,
        id
      )

    // Painted from the payload with no preview selection — the kit is not a choice.
    await expect.poll(() => textOf(DISPLAY_NAME_ID)).toBe(BRAND_TEXT['display-name'])
    await expect.poll(() => textOf(HANDLE_ID)).toBe(BRAND_TEXT.handle)
    // The content layer keeps its placeholder until a preview is picked.
    expect(await textOf('0:5')).toBe('عنوان تجريبي')
    await expect(page.getByTestId('ci-preview-menu')).toHaveAttribute('data-selection', 'none')
    // Not an edit.
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    expect(await page.evaluate(() => window.openPencil?.getStore?.()?.undo.canUndo ?? null)).toBe(
      false
    )

    // The Bindings panel lists the two names as optional, present bindings.
    // FB-78 (H-72): the section opens collapsed (Usable, cover met) and Brand text is its own
    // collapsed disclosure — open both to read the rows; the chip names the layer's role frame.
    await openBindings(page)
    const brandText = page.getByTestId('ci-brand-text')
    await expect(brandText).toBeVisible()
    await expect(brandText).toContainText('Brand text')
    await expect(brandText).toHaveAttribute('data-open', 'false')
    await brandText.getByRole('button', { name: 'Brand text' }).click()
    await expect(brandText).toHaveAttribute('data-open', 'true')
    await expect(page.getByTestId('ci-brand-text-display-name')).toHaveAttribute(
      'data-present',
      'true'
    )
    await expect(page.getByTestId('ci-brand-text-jump-handle')).toHaveText('cover')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-usable', 'true')

    // Selecting the layer shows its own words; deselecting brings the kit's text back.
    await page.evaluate((id) => window.openPencil?.getStore?.()?.select([id]), DISPLAY_NAME_ID)
    await expect.poll(() => textOf(DISPLAY_NAME_ID)).toBe('Your name')
    await page.evaluate(() => window.openPencil?.getStore?.()?.select([]))
    await expect.poll(() => textOf(DISPLAY_NAME_ID)).toBe(BRAND_TEXT['display-name'])
    await canvas.waitForRender()
    await page.screenshot({ path: test.info().outputPath('hosted-preview-brand-text.png') })

    // A real edit + Save version: the PUT carries the placeholders, never the kit's text.
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 40 })
    }, FRAME_ID)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Unsaved changes')
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(1)
    const sent = JSON.stringify(saves[0].document)
    expect(sent).toContain('Your name')
    expect(sent).toContain('@yourhandle')
    expect(sent).not.toContain(BRAND_TEXT['display-name'])
    expect(sent).not.toContain(BRAND_TEXT.handle)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')
    expect(await textOf(HANDLE_ID)).toBe(BRAND_TEXT.handle)
    canvas.assertNoErrors()
  })

  test('Track fb74-studio-preview-kinds (H-70): two sections — an article kind paints content:number / content:step (cover first, then repeat), never an edit, never saved; ?preview=kind:… preselects', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves, { fixture: 'hosted-template-kinds' })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    const textOf = (id: string) =>
      page.evaluate(
        (nodeId) => window.openPencil?.getStore?.()?.graph.getNode(nodeId)?.text ?? null,
        id
      )
    const menu = page.getByTestId('ci-preview-menu')

    // Two labelled sections: the Arabic candidate under the first, the kind row "<Kind> · <piece title>" under the second.
    await menu.click()
    await expect(page.getByTestId('ci-preview-menu-content')).toBeVisible()
    await expect(page.getByTestId('ci-preview-section-arabic')).toHaveText(GROUP_LABELS.arabic)
    await expect(page.getByTestId('ci-preview-section-kinds')).toHaveText(GROUP_LABELS.kinds)
    await expect(page.getByTestId(`ci-preview-candidate-${CANDIDATE.id}`)).toBeVisible()
    const kindRow = page.getByTestId(`ci-preview-candidate-${KIND_CANDIDATE.id}`)
    await expect(kindRow).toBeVisible()
    await expect(kindRow).toHaveAttribute('data-kind', 'how_to')
    await expect(kindRow).toContainText(`How-to · ${KIND_CANDIDATE.kind.pieceTitle}`)
    await expect(kindRow).toContainText('Written')
    await page.screenshot({ path: test.info().outputPath('hosted-preview-kinds-menu.png') })

    // Pick the kind: title · number · step 1 on the cover, body chunk + step 2 on the repeat, the ending's step stays.
    await kindRow.click()
    await expect.poll(() => textOf(KINDS.title)).toBe(KIND_CANDIDATE.title)
    await expect.poll(() => textOf(KINDS.number)).toBe(KIND_CANDIDATE.slots.number)
    await expect.poll(() => textOf(KINDS.coverStep)).toBe(KIND_CANDIDATE.slots.step[0])
    await expect.poll(() => textOf(KINDS.repeatStep)).toBe(KIND_CANDIDATE.slots.step[1])
    await expect.poll(() => textOf(KINDS.repeatBody)).toBe(KIND_CANDIDATE.bodyChunks[0])
    expect(await textOf(KINDS.endingStep)).toBe('الخطوة')
    await expect(menu).toHaveAttribute('data-selection', KIND_CANDIDATE.id)
    await expect(menu).toHaveAccessibleName(
      `Preview: How-to · ${KIND_CANDIDATE.kind.pieceTitle} — Preview content, not saved`
    )
    // Not an edit.
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v3')
    expect(await page.evaluate(() => window.openPencil?.getStore?.()?.undo.canUndo ?? null)).toBe(
      false
    )
    await canvas.waitForRender()
    await page.screenshot({ path: test.info().outputPath('hosted-preview-kinds.png') })

    // A real edit + Save version: the PUT carries the placeholders, never the kind's words.
    await page.evaluate((frameId) => {
      window.openPencil?.getStore?.()?.updateNode(frameId, { x: 40 })
    }, FRAME_ID)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Unsaved changes')
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.length).toBe(1)
    const sent = JSON.stringify(saves[0].document)
    expect(sent).toContain('٠')
    expect(sent).toContain('الخطوة')
    expect(sent).not.toContain(KIND_CANDIDATE.slots.number)
    expect(sent).not.toContain(KIND_CANDIDATE.slots.step[0])
    expect(sent).not.toContain(KIND_CANDIDATE.title)
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')
    expect(await textOf(KINDS.coverStep)).toBe(KIND_CANDIDATE.slots.step[0])

    // An Arabic candidate has no number / step: those layers go back to their placeholders, the title follows.
    await menu.click()
    await page.getByTestId(`ci-preview-candidate-${CANDIDATE.id}`).click()
    await expect.poll(() => textOf(KINDS.title)).toBe(CANDIDATE.title)
    await expect.poll(() => textOf(KINDS.number)).toBe('٠')
    await expect.poll(() => textOf(KINDS.coverStep)).toBe('الخطوة')
    await expect.poll(() => textOf(KINDS.repeatStep)).toBe('الخطوة')
    // None restores everything.
    await menu.click()
    await page.getByTestId('ci-preview-none').click()
    await expect.poll(() => textOf(KINDS.title)).toBe('عنوان تجريبي')
    await expect.poll(() => textOf(KINDS.repeatBody)).toBe('نص الشريحة')

    // `?preview=kind:<piece>:<key>` from the app pre-selects the kind on open.
    await page.goto(
      `/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}&preview=${encodeURIComponent(KIND_CANDIDATE.id)}`
    )
    await canvas.waitForInit()
    await expect.poll(() => textOf(KINDS.number)).toBe(KIND_CANDIDATE.slots.number)
    await expect.poll(() => textOf(KINDS.repeatStep)).toBe(KIND_CANDIDATE.slots.step[1])
    await expect(page.getByTestId('ci-preview-menu')).toHaveAttribute(
      'data-selection',
      KIND_CANDIDATE.id
    )
    await expect(page.getByTestId('ci-title-save-state')).toHaveText('Saved · v4')
    canvas.assertNoErrors()
  })

  test('Track fb74-studio-preview-kinds (H-70): an empty kinds section says so; an app without groups shows the one Arabic section', async ({
    page
  }) => {
    await installAPI(page, [], { fixture: 'hosted-template-kinds', kinds: [] })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await page.getByTestId('ci-preview-menu').click()
    await expect(page.getByTestId('ci-preview-section-kinds')).toBeVisible()
    await expect(page.getByTestId('ci-preview-kinds-empty')).toContainText('No article kinds yet')
    await expect(page.getByTestId(`ci-preview-candidate-${CANDIDATE.id}`)).toBeVisible()
    await page.keyboard.press('Escape')

    // An app before this track answers the flat list only → ONE section, headed as before.
    await installAPI(page, [], { fixture: 'hosted-template-kinds', kinds: null })
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await page.getByTestId('ci-preview-menu').click()
    await expect(page.getByTestId('ci-preview-section-arabic')).toHaveText(GROUP_LABELS.arabic)
    await expect(page.getByTestId('ci-preview-section-kinds')).toHaveCount(0)
    await expect(page.getByTestId(`ci-preview-candidate-${CANDIDATE.id}`)).toBeVisible()
    canvas.assertNoErrors()
  })

  test('Track FB-69: without brand.text (an older app) the layers keep their own words', async ({
    page
  }) => {
    const { text: _text, ...brandWithoutText } = BRAND
    await installAPI(page, [], {
      fixture: 'hosted-template-brand-text',
      brand: brandWithoutText,
      vocabulary: VOCABULARY_OLDER
    })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    expect(
      await page.evaluate(
        (id) => window.openPencil?.getStore?.()?.graph.getNode(id)?.text ?? null,
        DISPLAY_NAME_ID
      )
    ).toBe('Your name')
    await expect(page.getByTestId('ci-brand-text')).toHaveCount(0)
    canvas.assertNoErrors()
  })
})
