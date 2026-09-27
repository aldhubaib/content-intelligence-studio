// CI: FB-58 (ADR-058 §8 "As built — fix FB-58") — a dropped brand asset is a
// plain, editable shape. The Brand library still shows the asset as a
// component in the Assets panel, but inserting it lands ONE `RECTANGLE` named
// `brand:<kind>:<name>` carrying the image fill — no instance, no locked child —
// so a resize changes the shape itself; **Shape → Circle** turns it into an
// `ELLIPSE` with the same name; ⌘S writes the ellipse with its IMAGE fill.
import { expect, test } from '@playwright/test'

import { CanvasHelper } from '#tests/helpers/canvas'

import {
  API,
  BRAND,
  BRAND_ASSET,
  BRAND_ASSET_SIZE,
  FRAME_ID,
  TEMPLATE_ID,
  installAPI,
  type SavedBody
} from './hosted-api'

type NodeFacts = {
  id: string
  type: string
  name: string
  width: number
  height: number
  childIds: string[]
  fillType: string | null
  hasImage: boolean
  brandAsset: string | null
} | null

test.describe('hosted mode — brand asset is a plain shape (FB-58)', () => {
  test('insert → plain RECTANGLE that resizes; Shape → Circle → ELLIPSE with the same name; ⌘S saves the ellipse with its image fill', async ({
    page
  }) => {
    const saves: SavedBody[] = []
    await installAPI(page, saves, { brand: BRAND })
    const canvas = new CanvasHelper(page)

    await page.goto(`/?doc=${TEMPLATE_ID}&ws=nizek&token=smoke-token&api=${API}`)
    await canvas.waitForInit()
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')

    // The Brand library reached the Assets panel: one asset row for the hero image.
    await page.getByTestId('left-panel-assets-tab').click()
    const assetsPanel = page.getByTestId('assets-panel')
    await expect(assetsPanel).toBeVisible()
    await expect(assetsPanel).toContainText(`Brand — ${BRAND.workspaceName}`)
    // The panel names the asset by its binding; the list view carries the insert button.
    const brandName = `brand:${BRAND_ASSET.kind}:${BRAND_ASSET.name}`
    await page.getByTestId('assets-view-toggle').getByLabel('List view').click()
    const heroRow = page
      .getByTestId('asset-item')
      .filter({ has: page.getByTestId('asset-name').filter({ hasText: brandName }) })
    await expect(heroRow).toHaveCount(1)
    await heroRow.hover()
    await heroRow.getByTestId('asset-insert').click()

    // What landed on the page is ONE plain rectangle named by the binding —
    // the image fill on the node itself, no INSTANCE, no locked child.
    const facts = (): Promise<NodeFacts> =>
      page.evaluate((name) => {
        const store = window.openPencil?.getStore?.()
        if (!store) return null
        const node = [...store.graph.getAllNodes()].find(
          (n) => n.name === name && n.type !== 'COMPONENT'
        )
        if (!node) return null
        const fill = node.fills[0] ?? null
        const brand = node.pluginData?.find(
          (e) => e.pluginId === 'content-intelligence' && e.key === 'brandAsset'
        )
        return {
          id: node.id,
          type: node.type,
          name: node.name,
          width: node.width,
          height: node.height,
          childIds: [...node.childIds],
          fillType: fill?.type ?? null,
          hasImage: fill?.imageHash ? store.graph.images.has(fill.imageHash) : false,
          brandAsset: typeof brand?.value === 'string' ? brand.value : null
        }
      }, brandName)
    const currentFacts = async (): Promise<NonNullable<NodeFacts>> => {
      const value = await facts()
      if (!value) throw new Error(`no layer named ${brandName} on the page`)
      return value
    }
    await expect.poll(facts).not.toBeNull()
    const inserted = await currentFacts()
    expect(inserted.type).toBe('RECTANGLE')
    expect(inserted.childIds).toEqual([])
    expect(inserted.fillType).toBe('IMAGE')
    expect(inserted.hasImage).toBe(true)
    expect(inserted.brandAsset).toBe(BRAND_ASSET.id)
    expect({ width: inserted.width, height: inserted.height }).toEqual(BRAND_ASSET_SIZE)
    expect(
      await page.evaluate(
        () =>
          [...(window.openPencil?.getStore?.()?.graph.getAllNodes() ?? [])].filter(
            (n) => n.type === 'INSTANCE'
          ).length
      )
    ).toBe(0)
    // The insertion selected the shape (the Shape control follows the selection).
    const shapeControl = page.getByTestId('ci-shape-control')
    await expect(shapeControl).toBeVisible()
    await expect(shapeControl).toHaveAttribute('data-shape', 'RECTANGLE')
    await expect(shapeControl.getByRole('group', { name: 'Shape' })).toBeVisible()

    // Resizing changes the shape itself — width and height move, the fill stays.
    await page.evaluate(
      ([id, frameId]) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('store missing')
        store.reparentNodes([id], frameId)
        store.updateNode(id, { x: 100, y: 100, width: 300, height: 200 })
      },
      [inserted.id, FRAME_ID] as const
    )
    const resized = await currentFacts()
    expect({ width: resized.width, height: resized.height }).toEqual({ width: 300, height: 200 })
    expect(resized.type).toBe('RECTANGLE')
    expect(resized.fillType).toBe('IMAGE')
    await canvas.waitForRender()
    await page.screenshot({ path: test.info().outputPath('hosted-brand-shape-rectangle.png') })

    // Shape → Circle: the same node becomes an ELLIPSE — same id, same name, same fill.
    await shapeControl.getByLabel('Circle').click()
    await expect(shapeControl).toHaveAttribute('data-shape', 'ELLIPSE')
    const circle = await currentFacts()
    expect(circle.id).toBe(inserted.id)
    expect(circle.type).toBe('ELLIPSE')
    expect(circle.name).toBe(brandName)
    expect(circle.fillType).toBe('IMAGE')
    expect(circle.hasImage).toBe(true)
    expect({ width: circle.width, height: circle.height }).toEqual({ width: 300, height: 200 })
    // The Bindings panel lists it under the cover.
    await expect(page.getByTestId(`ci-binding-cover-${brandName}`)).toBeVisible()
    await canvas.waitForRender()
    await page.screenshot({ path: test.info().outputPath('hosted-brand-shape-circle.png') })

    // One undo step goes back to the rectangle; redo returns the circle.
    await page.evaluate(() => window.openPencil?.getStore?.()?.undo.undo())
    expect((await currentFacts()).type).toBe('RECTANGLE')
    await expect(shapeControl).toHaveAttribute('data-shape', 'RECTANGLE')
    await page.evaluate(() => window.openPencil?.getStore?.()?.undo.redo())
    expect((await currentFacts()).type).toBe('ELLIPSE')

    // ⌘S: the PUT body carries the ELLIPSE with its IMAGE fill and no children.
    await page.getByTestId('canvas-element').focus()
    await page.keyboard.press('ControlOrMeta+s')
    await expect.poll(() => saves.filter((s) => s.kind === 'version').length).toBe(1)
    const saved = saves.find((s) => s.kind === 'version')
    if (!saved) throw new Error('no version save recorded')
    const nodes = (saved.document as { graph: { nodes: Array<[string, Record<string, unknown>]> } })
      .graph.nodes
    const savedNode = nodes.find(([id]) => id === inserted.id)?.[1]
    expect(savedNode?.type).toBe('ELLIPSE')
    expect(savedNode?.name).toBe(brandName)
    const savedFills = (savedNode?.fills ?? []) as Array<{ type: string }>
    expect(savedFills[0]?.type).toBe('IMAGE')
    expect(savedNode?.childIds).toEqual([])
    expect(nodes.some(([, node]) => node.type === 'INSTANCE')).toBe(false)
    await expect(page.getByTestId('ci-bindings-status')).toHaveText('All changes saved.')
  })
})
