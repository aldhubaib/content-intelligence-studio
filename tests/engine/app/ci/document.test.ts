// CI: `openpencil-scene-graph` envelope round trip + brand string resolution.
import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import {
  DOCUMENT_FORMAT,
  base64ToBytes,
  bytesToBase64,
  deserializeGraph,
  isSerializedDocument,
  resolveBrandStrings,
  serializeGraph
} from '@/app/ci/document'

function sampleGraph(): SceneGraph {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const frame = graph.createNode('FRAME', page.id, { name: 'Portrait', width: 1080, height: 1350 })
  graph.createNode('TEXT', frame.id, {
    name: 'slot:headline',
    text: 'شلونك',
    fontFamily: 'Inter',
    boundVariables: { fontFamily: 'brand:fontArabic' },
    pluginData: [{ pluginId: 'content-intelligence', key: 'slot', value: 'headline' }]
  })
  graph.images.set('img-1', new Uint8Array([1, 2, 3, 250, 251]))
  graph.variableCollections.set('brand', {
    id: 'brand',
    name: 'Brand',
    modes: [{ modeId: 'brand-default', name: 'Default' }],
    defaultModeId: 'brand-default',
    variableIds: ['brand:fontArabic']
  } as never)
  graph.variables.set('brand:fontArabic', {
    id: 'brand:fontArabic',
    name: '$brand/fontArabic',
    type: 'STRING',
    collectionId: 'brand',
    valuesByMode: { 'brand-default': 'Noto Naskh Arabic' },
    description: '',
    hiddenFromPublishing: true
  } as never)
  graph.activeMode.set('brand', 'brand-default')
  return graph
}

describe('document envelope', () => {
  test('serialises to the app format and back without loss', () => {
    const graph = sampleGraph()
    const envelope = serializeGraph(graph, '0.15.1')
    expect(envelope.documentFormat).toBe(DOCUMENT_FORMAT)
    expect(envelope.schemaVersion).toBe(1)
    expect(envelope.engineVersion).toBe('0.15.1')
    expect(isSerializedDocument(envelope)).toBe(true)
    // Derived caches never travel.
    for (const [, node] of envelope.graph.nodes) {
      expect(node).not.toHaveProperty('textPicture')
      expect(node).not.toHaveProperty('derivedTextGlyphs')
    }
    // jsonb round trip
    const restored = deserializeGraph(structuredClone(envelope))
    expect(restored.rootId).toBe(graph.rootId)
    expect([...restored.nodes.keys()].sort()).toEqual([...graph.nodes.keys()].sort())
    expect(restored.images.get('img-1')).toEqual(new Uint8Array([1, 2, 3, 250, 251]))
    expect(restored.variables.get('brand:fontArabic')?.valuesByMode?.['brand-default']).toBe(
      'Noto Naskh Arabic'
    )
    expect(restored.activeMode.get('brand')).toBe('brand-default')
    const text = [...restored.getAllNodes()].find((node) => node.type === 'TEXT')
    expect(text?.pluginData).toEqual([
      { pluginId: 'content-intelligence', key: 'slot', value: 'headline' }
    ])
  })

  test('fills engine defaults for partial stored nodes', () => {
    const restored = deserializeGraph({
      documentFormat: DOCUMENT_FORMAT,
      schemaVersion: 1,
      engineVersion: 'fake',
      graph: {
        rootId: 'root',
        nodes: [
          ['root', { type: 'DOCUMENT', childIds: ['page'] }],
          ['page', { type: 'PAGE', parentId: 'root', childIds: ['r'] }],
          ['r', { type: 'RECTANGLE', parentId: 'page', width: 10, height: 20 }]
        ],
        images: [],
        variables: [],
        variableCollections: [],
        activeMode: [],
        documentColorSpace: 'sRGB'
      }
    })
    const rect = restored.getNode('r')
    expect(rect?.width).toBe(10)
    expect(rect?.visible).toBe(true)
    expect(rect?.fills).toBeDefined()
    expect(rect?.pluginData).toEqual([])
  })

  test('rejects anything that is not the envelope', () => {
    expect(isSerializedDocument({ documentFormat: 'pen' })).toBe(false)
    expect(() => deserializeGraph({ documentFormat: 'other' })).toThrow(
      /Unsupported document format/
    )
  })

  test('resolveBrandStrings applies the bound family on open', () => {
    const graph = sampleGraph()
    const updates: Array<[string, unknown]> = []
    const touched = resolveBrandStrings(graph, (id, changes) => {
      updates.push([id, changes])
      graph.updateNode(id, changes)
    })
    expect(touched).toHaveLength(1)
    expect(updates[0][1]).toEqual({ fontFamily: 'Noto Naskh Arabic' })
    // Idempotent once applied.
    expect(resolveBrandStrings(graph, () => undefined)).toEqual([])
  })

  test('base64 helpers round-trip binary data', () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 7) % 256)
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
})
