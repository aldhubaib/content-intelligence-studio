// CI: slot bindings read from a live graph.
import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { listSlotBindings, slotOf, slotReport } from '@/app/ci/slots'

describe('slots', () => {
  test('plugin data wins over the layer name; unknown names are not slots', () => {
    expect(slotOf({ name: 'slot:headline', pluginData: [] })).toBe('headline')
    expect(slotOf({ name: 'Headline', pluginData: [] })).toBeNull()
    expect(slotOf({ name: 'slot:banana', pluginData: [] })).toBeNull()
    expect(
      slotOf({
        name: 'slot:headline',
        pluginData: [{ pluginId: 'content-intelligence', key: 'slot', value: 'quote' }]
      })
    ).toBe('quote')
    expect(
      slotOf({
        name: 'slot:headline',
        pluginData: [{ pluginId: 'other-plugin', key: 'slot', value: 'quote' }]
      })
    ).toBe('headline')
  })

  test('reports bindings in paint order with maxChars, missing required and duplicates', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, { name: 'Portrait' })
    graph.createNode('TEXT', frame.id, {
      name: 'slot:headline',
      pluginData: [{ pluginId: 'content-intelligence', key: 'maxChars', value: '90' }]
    })
    graph.createNode('RECTANGLE', frame.id, { name: 'slot:cover' })
    graph.createNode('TEXT', frame.id, { name: 'slot:headline' })
    graph.createNode('RECTANGLE', frame.id, { name: 'slot:body' })

    const bindings = listSlotBindings(graph)
    expect(bindings.map((b) => b.slot)).toEqual(['headline', 'cover', 'headline', 'body'])
    expect(bindings[0].maxChars).toBe(90)
    expect(bindings[1].typeMismatch).toBe(false)
    expect(bindings[3].typeMismatch).toBe(true)

    const report = slotReport(graph, ['headline', 'body', 'quote', 'not-a-slot'])
    expect(report.missingRequired).toEqual(['quote'])
    expect(report.duplicates).toEqual(['headline'])
  })
})
