// CI: Track FB-61 (PATCHES H-66 / H-67) — templates are contracts. The Bindings
// panel renders the format-aware checklist from the app's `contract` block, the
// rows follow the LIVE graph, **Add role frame ▾** offers only the contract's
// roles, and a stray `repeat` frame on a single-image format is ONE yellow line
// "Not used by this format" — never a blocking reason.
//
// FB-78 (PATCHES H-72): the Bindings section is a real disclosure — collapsed by
// default when the template is Usable and every contract role is met, open when
// something is missing, remembered per browser; the collapsed header carries the
// verdict; the open body is bounded so the design inspector below keeps at least
// half the column; "Add role frame ▾" stays reachable while collapsed; Brand text
// is its own disclosure with one chip per layer named by the role frame holding it.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  BRAND,
  CAROUSEL,
  TEMPLATE_ID,
  bindingsToggle,
  contractFor,
  installAPI,
  openBindings,
  type SavedBody
} from './hosted-api'

async function openHosted(
  page: Parameters<typeof installAPI>[0],
  saves: SavedBody[],
  options: Parameters<typeof installAPI>[2]
) {
  await installAPI(page, saves, options)
  const canvas = new CanvasHelper(page)
  await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
  await canvas.waitForInit()
  await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
  return canvas
}

/**
 * A top-level frame named `name` through the store (so the session's graph tick fires),
 * optionally with a `content:body` text; `x` keeps several added frames apart. Returns the id.
 */
async function addFrame(
  page: Parameters<typeof installAPI>[0],
  name: string,
  withBodyText: boolean,
  x = 2400
): Promise<string> {
  return page.evaluate(
    ({ name, withBodyText, x }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      const frameId = store.createShape('FRAME', x, 0, 1080, 1350, store.state.currentPageId, name)
      store.updateNode(frameId, { name })
      if (withBodyText) {
        const textId = store.createShape('TEXT', 40, 40, 800, 200, frameId, 'Body copy')
        store.updateNode(textId, { name: 'content:body' })
      }
      return frameId
    },
    { name, withBodyText, x }
  )
}

/** A text layer named `layerName` inside `frameId` (FB-78: brand text layers in role frames). */
async function addTextLayer(
  page: Parameters<typeof installAPI>[0],
  frameId: string,
  layerName: string
): Promise<void> {
  await page.evaluate(
    ({ frameId, layerName }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      const textId = store.createShape('TEXT', 40, 1200, 600, 60, frameId, layerName)
      store.updateNode(textId, { name: layerName })
    },
    { frameId, layerName }
  )
}

/** Rename the layer `id` (FB-78: unbind the cover's title to make the template Not usable). */
async function renameLayer(
  page: Parameters<typeof installAPI>[0],
  id: string,
  name: string
): Promise<void> {
  await page.evaluate(
    ({ id, name }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      store.updateNode(id, { name })
    },
    { id, name }
  )
}

test.describe('hosted mode — the format contract (FB-61)', () => {
  test('carousel format: three checklist rows from the payload, live re-judged; Add role frame ▾ lists the contract roles', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    const canvas = await openHosted(page, saves, {
      format: CAROUSEL,
      contract: contractFor(CAROUSEL)
    })

    // FB-78: a contract row is not met → the section opens by default.
    await expect(page.getByTestId('ci-bindings-panel')).toHaveAttribute('data-open', 'true')
    const checklist = page.getByTestId('ci-contract-checklist')
    await expect(checklist).toBeVisible()
    await expect(checklist.locator('li')).toHaveCount(3)
    await expect(page.getByTestId('ci-contract-cover')).toHaveAttribute(
      'title',
      'Cover (required) — needs content:title or content:body'
    )
    await expect(page.getByTestId('ci-contract-words-cover')).toHaveText('met')
    await expect(page.getByTestId('ci-contract-repeat')).toHaveAttribute(
      'title',
      'Repeat — needs content:body'
    )
    await expect(page.getByTestId('ci-contract-words-repeat')).toHaveText(
      'not met — add a repeat frame with content:body'
    )
    await expect(page.getByTestId('ci-contract-ending')).toHaveAttribute(
      'title',
      'Ending (optional) — takes content:cta'
    )
    await expect(page.getByTestId('ci-contract-words-ending')).toHaveText('not added — optional')
    await expect(page.getByTestId('ci-contract-helper')).toHaveText(
      `Cover is the first slide. Long pieces fill Repeat slides (up to ${CAROUSEL.slideCap}) and end on Ending.`
    )
    await expect(page.getByTestId('ci-contract-unused-repeat')).toHaveCount(0)

    // Add role frame ▾ offers exactly the contract's roles (H-66).
    await page.getByTestId('ci-add-role-frame').first().click()
    await expect(page.getByTestId('ci-add-role-cover')).toBeVisible()
    await expect(page.getByTestId('ci-add-role-repeat')).toBeVisible()
    await expect(page.getByTestId('ci-add-role-ending')).toBeVisible()
    await page.keyboard.press('Escape')

    // A repeat frame WITH content:body → the row is met live, the carousel is usable.
    await addFrame(page, 'repeat', true)
    await expect(page.getByTestId('ci-contract-words-repeat')).toHaveText('met')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-carousel', 'true')

    canvas.assertNoErrors()
  })

  test('single-image format: one row, the single-image helper, Add role frame ▾ lists Cover alone; a stray repeat is "Not used by this format"', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    const canvas = await openHosted(page, saves, {})

    // FB-78: Usable and the one row met → collapsed by default; open it to read the body.
    await expect(page.getByTestId('ci-bindings-panel')).toHaveAttribute('data-open', 'false')
    await openBindings(page)
    await expect(page.getByTestId('ci-contract-checklist').locator('li')).toHaveCount(1)
    await expect(page.getByTestId('ci-contract-words-cover')).toHaveText('met')
    await expect(page.getByTestId('ci-contract-helper')).toHaveText(
      'This format is a single image. Design the Cover.'
    )

    await page.getByTestId('ci-add-role-frame').first().click()
    await expect(page.getByTestId('ci-add-role-cover')).toBeVisible()
    await expect(page.getByTestId('ci-add-role-repeat')).toHaveCount(0)
    await expect(page.getByTestId('ci-add-role-ending')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // A `repeat` frame without content:body on a single-image format: never `repeat_without_body`,
    // the template stays Usable, and the panel shows ONE yellow line for it.
    await addFrame(page, 'repeat', false)
    await expect(page.getByTestId('ci-contract-unused-repeat')).toHaveCount(1)
    await expect(page.getByTestId('ci-contract-unused-repeat')).toContainText(
      'Repeat — Not used by this format'
    )
    await expect(page.getByTestId('ci-role-words-repeat')).toHaveText('not used by this format')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveText('Usable')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-carousel', 'false')
    await expect(page.getByTestId('ci-contract-checklist').locator('li')).toHaveCount(1)

    canvas.assertNoErrors()
  })

  test('older app without a contract block: the Studio derives the checklist from slideCap', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    const canvas = await openHosted(page, saves, {
      format: CAROUSEL,
      contract: null
    })
    await expect(page.getByTestId('ci-contract-checklist').locator('li')).toHaveCount(3)
    await expect(page.getByTestId('ci-contract-repeat')).toHaveAttribute(
      'title',
      'Repeat — needs content:body'
    )
    await expect(page.getByTestId('ci-contract-helper')).toHaveText(
      `Cover is the first slide. Long pieces fill Repeat slides (up to ${CAROUSEL.slideCap}) and end on Ending.`
    )
    canvas.assertNoErrors()
  })
})

test.describe('hosted mode — the Bindings section is a disclosure (FB-78)', () => {
  test('Usable single image: collapsed by default with the verdict in the header; Enter and Space toggle; the toggle is remembered across a reload', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    const canvas = await openHosted(page, saves, {})
    const panel = page.getByTestId('ci-bindings-panel')
    const toggle = bindingsToggle(page)
    const summary = panel.locator('[data-slot="section-summary"]')
    const checklist = page.getByTestId('ci-contract-checklist')

    // Collapsed: the heading holds a real button, the verdict rides beside the label.
    await expect(panel).toHaveAttribute('data-open', 'false')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toContainText('Bindings')
    await expect(summary).toHaveText('· Usable')
    await expect(summary).toHaveAttribute('title', 'Usable')
    await expect(checklist).toBeHidden()
    const controls = await toggle.getAttribute('aria-controls')
    expect(controls).toBeTruthy()

    // Keyboard: Enter opens, Space closes.
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(panel).toHaveAttribute('data-open', 'true')
    await expect(checklist).toBeVisible()
    await expect(page.locator(`#${controls}`)).toBeVisible()
    await expect(summary).toHaveCount(0)
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(checklist).toBeHidden()

    // The person's choice is remembered per browser and wins over the collapsed default.
    // Re-enter through the hosted URL the app hands out — the token is scrubbed from the address
    // bar on boot (E3c), so a bare `page.reload()` would open the standalone Studio instead.
    await toggle.click()
    await expect(panel).toHaveAttribute('data-open', 'true')
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    await expect(page.getByTestId('ci-bindings-panel')).toHaveAttribute('data-open', 'true')
    await expect(bindingsToggle(page)).toHaveAttribute('aria-expanded', 'true')

    canvas.assertNoErrors()
  })

  test('the collapsed header carries the Not usable sentence when the cover loses its text', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    const canvas = await openHosted(page, saves, {})
    const panel = page.getByTestId('ci-bindings-panel')
    await expect(panel).toHaveAttribute('data-open', 'false')

    // Unbind the cover's title (fixture layer 0:5) → blocking reason, words in the header.
    await renameLayer(page, '0:5', 'Headline')
    const summary = panel.locator('[data-slot="section-summary"]')
    await expect(summary).toHaveText(
      '· Not usable yet — cover has no content:title or content:body'
    )
    await expect(summary).toHaveAttribute(
      'title',
      'Not usable yet — cover has no content:title or content:body'
    )
    // The default was judged once at load — the section does not flip open under the person.
    await expect(panel).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-usable', 'false')

    canvas.assertNoErrors()
  })

  test('three-role template with brand text layers: the open body is bounded so the inspector stays reachable; Brand text is one chip per layer named by role; Add role frame ▾ works while collapsed', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    const canvas = await openHosted(page, saves, {
      fixture: 'hosted-template-brand-text',
      format: CAROUSEL,
      contract: contractFor(CAROUSEL),
      brand: BRAND
    })
    const panel = page.getByTestId('ci-bindings-panel')
    // Repeat not met → open by default.
    await expect(panel).toHaveAttribute('data-open', 'true')

    // Build the owner's case: cover (fixture, with brand:display-name + brand:handle) + repeat + ending,
    // and a second brand:handle layer inside the repeat frame.
    const repeatId = await addFrame(page, 'repeat', true, 2400)
    await addFrame(page, 'ending', false, 3600)
    await addTextLayer(page, repeatId, 'brand:handle')
    await expect(page.getByTestId('ci-contract-words-repeat')).toHaveText('met')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-carousel', 'true')

    // Bounded: the open section takes at most 45 % of the inspector column and the design
    // inspector below keeps at least half of it — its tab strip is on screen.
    const column = panel.locator('xpath=..')
    const heightOf = async (target: typeof panel) => (await target.boundingBox())?.height ?? 0
    const columnHeight = await heightOf(column)
    expect(columnHeight).toBeGreaterThan(0)
    expect(await heightOf(panel)).toBeLessThanOrEqual(columnHeight * 0.45 + 1)
    expect(await heightOf(page.getByTestId('properties-panel'))).toBeGreaterThanOrEqual(
      columnHeight * 0.5
    )
    await expect(page.getByTestId('properties-tab-design')).toBeInViewport()
    await expect(page.getByTestId('properties-tab-names')).toBeInViewport()

    // Brand text: its own disclosure, collapsed by default, one chip per layer named by the role frame.
    const brandText = page.getByTestId('ci-brand-text')
    await expect(brandText).toBeVisible()
    await expect(brandText).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('ci-brand-text-count')).toHaveText('2 of 2 added')
    await brandText.getByRole('button', { name: 'Brand text' }).click()
    await expect(brandText).toHaveAttribute('data-open', 'true')
    const displayNameChips = page.getByTestId('ci-brand-text-jump-display-name')
    const handleChips = page.getByTestId('ci-brand-text-jump-handle')
    await expect(displayNameChips).toHaveCount(1)
    await expect(displayNameChips).toHaveText('cover')
    await expect(handleChips).toHaveCount(2)
    await expect(handleChips).toHaveText(['cover', 'repeat'])
    await expect(brandText).not.toContainText('added 2 times')
    await expect(brandText).not.toContainText('added 3 times')
    // No count word on a name's row at all — the row is the name, its chips and the description.
    await expect(page.getByTestId('ci-brand-text-handle')).not.toContainText('added')
    await expect(page.getByTestId('ci-brand-text-display-name')).not.toContainText('added')
    await expect(handleChips.nth(1)).toHaveAccessibleName('Jump to brand:handle in repeat')

    // Collapse the section: the header still offers Add role frame ▾ with the contract's roles.
    await bindingsToggle(page).click()
    await expect(panel).toHaveAttribute('data-open', 'false')
    await expect(page.getByTestId('ci-contract-checklist')).toBeHidden()
    await page.getByTestId('ci-add-role-frame').first().click()
    await expect(page.getByTestId('ci-add-role-cover')).toBeVisible()
    await expect(page.getByTestId('ci-add-role-repeat')).toBeVisible()
    await expect(page.getByTestId('ci-add-role-ending')).toBeVisible()
    await page.keyboard.press('Escape')

    await page.screenshot({ path: test.info().outputPath('hosted-bindings-collapsed.png') })
    canvas.assertNoErrors()
  })
})
