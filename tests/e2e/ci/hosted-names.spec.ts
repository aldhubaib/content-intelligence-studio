// CI: Track FB-65 (ADR-058 §8 "As built — Track FB-65") — the **Names** tab:
// every layer name the system fills, in the payload's order with the payload's
// sentences; a click copies the name; with a layer selected **Rename selected
// layer** applies it in one undo step and the Bindings report follows.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  BRAND,
  BRAND_ASSET,
  TEMPLATE_ID,
  VOCABULARY,
  VOCABULARY_OLDER,
  installAPI,
  type SavedBody
} from './hosted-api'

/** The fixture's `content:title` text layer inside the `cover` frame. */
const TITLE_ID = '0:5'

const EXPECTED_ROWS = [
  ...VOCABULARY.contentText.map((s) => `content:${s}`),
  ...VOCABULARY.contentImage.map((s) => `content:${s}`),
  ...VOCABULARY.reserved.map((s) => `content:${s}`),
  ...VOCABULARY.brandKinds.map((k) => `brand:${k}`),
  'brand:<kind>:<asset name>',
  `brand:${BRAND_ASSET.kind}:${BRAND_ASSET.name}`,
  // Track FB-69: the Brand text group after the asset rows.
  ...VOCABULARY.brandText.map((s) => `brand:${s}`),
  ...VOCABULARY.roles
]

test.describe('hosted mode — Names tab (FB-65)', () => {
  test('rows from the payload in order → click copies → Rename selected layer renames in one undo step', async ({
    page
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    const saves: SavedBody[] = []
    await installAPI(page, saves, { brand: BRAND })
    const canvas = new CanvasHelper(page)

    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')

    // The fourth tab sits after Code; AI is off in this payload so it is the last one.
    const tabs = page.getByTestId('properties-panel').getByRole('tab')
    await expect(tabs).toHaveText(['Design', 'Code', 'Names'])
    await page.getByTestId('properties-tab-names').click()
    const panel = page.getByTestId('ci-names-panel')
    await expect(panel).toBeVisible()
    await expect(panel.getByTestId('ci-names-lead')).toHaveText(
      'Name a layer exactly like this and the system fills it.'
    )
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText([
      'Content',
      'Brand',
      'Brand text',
      'Frames'
    ])

    // Every row in the payload's order, each with the payload's sentence.
    const names = panel.locator('li[data-kind] code')
    await expect(names).toHaveText(EXPECTED_ROWS)
    await expect(panel.getByTestId('ci-name-row-content-body')).toContainText(
      'the body text; on a carousel the chunk for that slide'
    )
    // Track FB-69: the Brand text group — its lead sentence and the two described rows.
    await expect(panel.getByTestId('ci-names-group-lead-brand-text')).toHaveText(
      'Text layers the brand kit fills — optional, and empty when the kit has no value.'
    )
    await expect(panel.getByTestId('ci-name-row-brand-display-name')).toContainText(
      "the brand kit's display name (text; empty when the kit has none)"
    )
    await expect(panel.getByTestId('ci-name-row-brand-handle')).toContainText(
      "the brand kit's handle as @handle (text; empty when the kit has none)"
    )
    await expect(panel.getByTestId('ci-name-row-brand-handle')).toHaveAttribute(
      'data-kind',
      'brand-text'
    )
    await expect(panel.getByTestId('ci-name-row-brand-kind-asset-name')).toContainText(
      'a named asset instead of the default'
    )
    await expect(panel.getByTestId('ci-name-row-brand-user-image-hero')).toContainText(
      'Hero · user image (default)'
    )
    await expect(panel.getByTestId('ci-name-row-cover')).toContainText(
      'required, the first / only image'
    )
    // Nothing selected → no rename buttons anywhere.
    await expect(panel).toHaveAttribute('data-selection', 'false')
    await expect(panel.getByRole('button', { name: /^Rename selected layer/ })).toHaveCount(0)

    // Click a name → clipboard + "Copied" in the row's status.
    const copyTitle = panel.getByRole('button', { name: 'Copy content:title' })
    await copyTitle.click()
    await expect(panel.getByTestId('ci-name-status-content-title')).toHaveText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('content:title')
    await expect(panel.getByTestId('ci-name-status-content-title')).toHaveText('', {
      timeout: 4000
    })

    // Keyboard: Enter on a focused row copies too.
    await panel.getByRole('button', { name: 'Copy cover' }).focus()
    await page.keyboard.press('Enter')
    await expect(panel.getByTestId('ci-name-status-cover')).toHaveText('Copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('cover')

    // Select the title layer → a second button per row; Rename selected layer → content:subtitle.
    await page.evaluate((id) => {
      const store = window.openPencil?.getStore?.()
      if (!store) throw new Error('store missing')
      store.select([id])
    }, TITLE_ID)
    await expect(panel).toHaveAttribute('data-selection', 'true')
    // The placeholder row carries no rename button — the asset sub-row does.
    await expect(
      panel.getByTestId('ci-name-row-brand-kind-asset-name').getByRole('button')
    ).toHaveCount(1)
    await expect(
      panel.getByTestId('ci-name-row-brand-user-image-hero').getByRole('button')
    ).toHaveCount(2)
    // Track FB-69: a brand text row renames like every other row.
    await expect(panel.getByTestId('ci-name-row-brand-handle').getByRole('button')).toHaveCount(2)
    await panel.getByRole('button', { name: 'Rename selected layer to content:subtitle' }).click()
    await expect(panel.getByTestId('ci-name-status-content-subtitle')).toHaveText(
      'Renamed to content:subtitle'
    )
    const layerName = () =>
      page.evaluate(
        (id) => window.openPencil?.getStore?.()?.graph.getNode(id)?.name ?? null,
        TITLE_ID
      )
    expect(await layerName()).toBe('content:subtitle')
    // The Bindings report follows: the cover lost its title → not usable.
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-usable', 'false')
    await expect(page.getByTestId('ci-bindings-status')).toContainText('Unsaved changes')

    // ONE undo step puts the name back; the Bindings report is OK again.
    await page.evaluate(() => window.openPencil?.getStore?.()?.undo.undo())
    expect(await layerName()).toBe('content:title')
    await expect(page.getByTestId('ci-bindings-usable')).toHaveAttribute('data-usable', 'true')

    // Deselect → the rename buttons leave; the copy rows stay.
    await page.evaluate(() => window.openPencil?.getStore?.()?.select([]))
    await expect(panel).toHaveAttribute('data-selection', 'false')
    await expect(panel.getByRole('button', { name: /^Rename selected layer/ })).toHaveCount(0)
    await expect(copyTitle).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('hosted-names-tab.png') })
  })

  test('Track FB-69: an older app without brandText shows three groups and no Brand text rows', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves, { brand: BRAND, vocabulary: VOCABULARY_OLDER })
    const canvas = new CanvasHelper(page)
    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
    await page.getByTestId('properties-tab-names').click()
    const panel = page.getByTestId('ci-names-panel')
    await expect(panel.getByRole('heading', { level: 3 })).toHaveText([
      'Content',
      'Brand',
      'Frames'
    ])
    await expect(panel.locator('li[data-kind="brand-text"]')).toHaveCount(0)
    await expect(page.getByTestId('ci-brand-text')).toHaveCount(0)
  })
})
