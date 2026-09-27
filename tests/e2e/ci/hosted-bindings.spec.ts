// CI: Track FB-61 (PATCHES H-66 / H-67) — templates are contracts. The Bindings
// panel renders the format-aware checklist from the app's `contract` block, the
// rows follow the LIVE graph, **Add role frame ▾** offers only the contract's
// roles, and a stray `repeat` frame on a single-image format is ONE yellow line
// "Not used by this format" — never a blocking reason.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import { API, CAROUSEL, TEMPLATE_ID, contractFor, installAPI, type SavedBody } from './hosted-api'

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

/** A top-level frame named `name` through the store (so the session's graph tick fires), optionally with a `content:body` text. */
async function addFrame(
  page: Parameters<typeof installAPI>[0],
  name: string,
  withBodyText: boolean
) {
  await page.evaluate(
    ({ name, withBodyText }) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      const frameId = store.createShape(
        'FRAME',
        2400,
        0,
        1080,
        1350,
        store.state.currentPageId,
        name
      )
      store.updateNode(frameId, { name })
      if (withBodyText) {
        const textId = store.createShape('TEXT', 40, 40, 800, 200, frameId, 'Body copy')
        store.updateNode(textId, { name: 'content:body' })
      }
    },
    { name, withBodyText }
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

    const checklist = page.getByTestId('ci-contract-checklist')
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
