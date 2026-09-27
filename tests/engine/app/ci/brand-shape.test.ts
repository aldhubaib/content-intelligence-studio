// CI: FB-58 — a brand asset is a plain, editable shape: insertion, detach on
// load, Rectangle ⇄ Circle.
import { afterEach, describe, expect, test } from 'bun:test'

import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

import type { StudioBrandAsset } from '@/app/ci/api'
import { bindingOf, DEFAULT_VOCABULARY, PLUGIN_ID, pluginValue } from '@/app/ci/bindings'
import { brandAssetBindingName, buildBrandLibraryGraph } from '@/app/ci/brand-library'
import {
  brandShapeFacts,
  detachBrandInstances,
  insertBrandShape,
  isBrandLibraryComponent,
  setBrandShape,
  shapeControlApplies
} from '@/app/ci/brand-shape'
import { deserializeGraph, serializeGraph } from '@/app/ci/document'
import { hostedInsertHandler, setHostedInsertHandler } from '@/app/ci/insert-override'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'

const HERO: StudioBrandAsset = {
  id: 'asset-hero',
  name: 'Hero',
  url: 'https://app.example.com/api/studio/templates/t/assets/asset-hero',
  kind: 'user-image',
  isDefault: true,
  contentType: 'image/png'
}
const MARK: StudioBrandAsset = {
  ...HERO,
  id: 'asset-mark',
  name: 'Mark',
  kind: 'company-logo-dark',
  isDefault: false
}
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])

/** Copy the published library's component (and its image) into a store's graph, the way `materialize` does. */
function publishInto(
  store: EditorStore,
  asset: StudioBrandAsset,
  size = { width: 640, height: 480 }
) {
  const { graph: library, componentIds } = buildBrandLibraryGraph([{ asset, bytes: BYTES, size }])
  const source = getNodeOrThrow(library, componentIds[0])
  const page = store.graph.getPages()[0]
  const component = store.graph.createNode('COMPONENT', page.id, {
    ...withoutTree(source),
    x: 2000,
    y: 2000
  })
  for (const child of library.getChildren(source.id)) {
    store.graph.createNode(child.type, component.id, withoutTree(child))
  }
  for (const [hash, bytes] of library.images) store.graph.images.set(hash, bytes)
  return component
}

function withoutTree(node: SceneNode): Partial<SceneNode> {
  const { id: _id, parentId: _parentId, childIds: _childIds, ...rest } = node
  return rest
}

const stores: EditorStore[] = []
function makeStore(): EditorStore {
  const store = createEditorStore()
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
  setHostedInsertHandler(null)
})

describe('isBrandLibraryComponent', () => {
  test('a component the brand library published, or a legacy brand:* component over one image child', () => {
    const store = makeStore()
    const published = publishInto(store, HERO)
    expect(isBrandLibraryComponent(store.graph, published)).toBe(true)

    const page = store.graph.getPages()[0]
    const legacy = store.graph.createNode('COMPONENT', page.id, {
      name: 'brand:user-image:Old',
      width: 100,
      height: 100
    })
    store.graph.createNode('RECTANGLE', legacy.id, {
      fills: [
        {
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          imageHash: 'h'
        }
      ]
    })
    expect(isBrandLibraryComponent(store.graph, legacy)).toBe(true)

    const plain = store.graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 10,
      height: 10
    })
    expect(isBrandLibraryComponent(store.graph, plain)).toBe(false)
    expect(isBrandLibraryComponent(store.graph, undefined)).toBe(false)
  })
})

describe('insertBrandShape', () => {
  test('creates ONE plain RECTANGLE named by the binding with the image fill, size and pluginData — no instance, no child', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const page = store.graph.getPages()[0]
    const cover = store.graph.createNode('FRAME', page.id, {
      name: 'cover',
      width: 1080,
      height: 1350
    })

    const id = insertBrandShape(store, component.id, 100, 200, cover.id)
    expect(typeof id).toBe('string')
    const node = getNodeOrThrow(store.graph, expectDefined(id))
    expect(node.type).toBe('RECTANGLE')
    expect(node.parentId).toBe(cover.id)
    expect(node.childIds).toEqual([])
    expect(node.name).toBe(brandAssetBindingName(HERO))
    expect(bindingOf(node, DEFAULT_VOCABULARY)).toEqual({
      kind: 'brand',
      slotKind: 'user-image',
      name: 'Hero'
    })
    expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual({
      x: 100,
      y: 200,
      width: 640,
      height: 480
    })
    expect(node.fills).toHaveLength(1)
    expect(node.fills[0].type).toBe('IMAGE')
    expect(node.fills[0].imageScaleMode).toBe('FILL')
    expect(store.graph.images.has(expectDefined(node.fills[0]?.imageHash))).toBe(true)
    expect(pluginValue(node, 'brandAsset')).toBe(HERO.id)
    expect(pluginValue(node, 'brandAssetKind')).toBe('user-image')
    expect(pluginValue(node, 'role')).toBe('accent')
    expect([...store.state.selectedIds]).toEqual([id])
    // No instance anywhere — the component is only the panel's presentation.
    expect([...store.graph.nodes.values()].some((n) => n.type === 'INSTANCE')).toBe(false)
  })

  test('a logo keeps FIT and the working size the library chose', () => {
    const store = makeStore()
    const component = publishInto(store, MARK, { width: 2400, height: 1200 })
    const id = expectDefined(insertBrandShape(store, component.id, 0, 0))
    const node = getNodeOrThrow(store.graph, id)
    expect(node.fills[0].imageScaleMode).toBe('FIT')
    expect({ width: node.width, height: node.height }).toEqual({ width: 480, height: 240 })
    expect(pluginValue(node, 'role')).toBe('logo')
  })

  test('resizing scales the shape itself — width and height change, nothing clips', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const id = expectDefined(insertBrandShape(store, component.id, 0, 0))
    store.updateNode(id, { width: 320, height: 240 })
    const node = getNodeOrThrow(store.graph, id)
    expect({ width: node.width, height: node.height }).toEqual({ width: 320, height: 240 })
    expect(node.childIds).toEqual([])
  })

  test('one undo entry: undo removes the shape, redo brings the same node back', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const id = expectDefined(insertBrandShape(store, component.id, 10, 10))
    expect(store.graph.getNode(id)).toBeDefined()
    store.undo.undo()
    expect(store.graph.getNode(id)).toBeUndefined()
    store.undo.redo()
    const back = getNodeOrThrow(store.graph, id)
    expect(back.type).toBe('RECTANGLE')
    expect(back.fills[0].type).toBe('IMAGE')
    expect(back.name).toBe(brandAssetBindingName(HERO))
  })

  test('answers undefined for a component that is not a brand asset — upstream keeps the instance path', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const button = store.graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 80,
      height: 32
    })
    expect(insertBrandShape(store, button.id, 0, 0)).toBeUndefined()
    expect(insertBrandShape(store, 'missing', 0, 0)).toBeUndefined()
  })

  test('the store seam: with a hosted handler registered, createInstanceFromComponent yields the shape; standalone it yields an instance', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    expect(hostedInsertHandler()).toBeNull()
    const instanceId = expectDefined(store.createInstanceFromComponent(component.id, 0, 0))
    expect(store.graph.getNode(instanceId)?.type).toBe('INSTANCE')

    setHostedInsertHandler((componentId, x, y, parentId) =>
      insertBrandShape(store, componentId, x, y, parentId)
    )
    const shapeId = expectDefined(store.createInstanceFromComponent(component.id, 5, 6))
    const shape = getNodeOrThrow(store.graph, shapeId)
    expect(shape.type).toBe('RECTANGLE')
    expect({ x: shape.x, y: shape.y }).toEqual({ x: 5, y: 6 })

    // A non-brand component still becomes an instance through the same seam.
    const page = store.graph.getPages()[0]
    const button = store.graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 80,
      height: 32
    })
    const other = expectDefined(store.createInstanceFromComponent(button.id, 0, 0))
    expect(store.graph.getNode(other)?.type).toBe('INSTANCE')
  })

  test('brandShapeFacts reads the component: name, size, the child image fill, the three plugin keys', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const facts = expectDefined(brandShapeFacts(store.graph, component))
    expect(facts.name).toBe('brand:user-image:Hero')
    expect(facts.width).toBe(640)
    expect(facts.fills[0].type).toBe('IMAGE')
    expect(facts.pluginData.map((e) => e.key).sort()).toEqual([
      'brandAsset',
      'brandAssetKind',
      'role'
    ])
    expect(facts.pluginData.every((e) => e.pluginId === PLUGIN_ID)).toBe(true)
  })
})

describe('detachBrandInstances (heal on load)', () => {
  function savedTemplateWithInstance() {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const page = store.graph.getPages()[0]
    const cover = store.graph.createNode('FRAME', page.id, {
      name: 'cover',
      width: 1080,
      height: 1350
    })
    const instanceId = expectDefined(
      store.createInstanceFromComponent(component.id, 120, 130, cover.id)
    )
    store.updateNode(instanceId, { opacity: 0.5, cornerRadius: 24 })
    const instance = getNodeOrThrow(store.graph, instanceId)
    expect(instance.type).toBe('INSTANCE')
    expect(instance.childIds).toHaveLength(1)
    const document = serializeGraph(store.graph, '0.15.1')
    return { document, instanceId, coverId: cover.id, componentId: component.id }
  }

  test('every brand instance becomes the plain shape on the deserialised graph — same id, name, fill, size, position, pluginData, opacity, radius', () => {
    const { document, instanceId, coverId } = savedTemplateWithInstance()
    const graph = deserializeGraph(structuredClone(document))
    expect(graph.getNode(instanceId)?.type).toBe('INSTANCE')

    const report = detachBrandInstances(graph)
    expect(report).toEqual({ detached: 1, nodeIds: [instanceId] })
    const node = getNodeOrThrow(graph, instanceId)
    expect(node.type).toBe('RECTANGLE')
    expect(node.componentId).toBeNull()
    expect(node.childIds).toEqual([])
    expect(node.parentId).toBe(coverId)
    expect(node.name).toBe('brand:user-image:Hero')
    expect({ x: node.x, y: node.y, width: node.width, height: node.height }).toEqual({
      x: 120,
      y: 130,
      width: 640,
      height: 480
    })
    expect(node.opacity).toBe(0.5)
    expect(node.cornerRadius).toBe(24)
    expect(node.fills).toHaveLength(1)
    expect(node.fills[0].type).toBe('IMAGE')
    expect(node.fills[0].imageScaleMode).toBe('FILL')
    expect(graph.images.has(expectDefined(node.fills[0]?.imageHash))).toBe(true)
    expect(pluginValue(node, 'brandAsset')).toBe(HERO.id)
    expect(pluginValue(node, 'brandAssetKind')).toBe('user-image')
    // The child rectangle is gone from the graph, not orphaned.
    expect([...graph.nodes.values()].filter((n) => n.type === 'INSTANCE')).toHaveLength(0)
    expect(graph.instanceIndex.get(document.graph.rootId)).toBeUndefined()
  })

  test('idempotent: a second pass detaches nothing, and the next save writes the plain node', () => {
    const { document, instanceId } = savedTemplateWithInstance()
    const graph = deserializeGraph(structuredClone(document))
    detachBrandInstances(graph)
    expect(detachBrandInstances(graph)).toEqual({ detached: 0, nodeIds: [] })
    const saved = serializeGraph(graph, '0.15.1')
    const stored = saved.graph.nodes.find(([id]) => id === instanceId)?.[1]
    expect(stored.type).toBe('RECTANGLE')
    expect(stored.componentId).toBeNull()
    expect((stored.fills as Array<{ type: string }>)[0].type).toBe('IMAGE')
  })

  test('leaves an instance of an ordinary component alone', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const button = store.graph.createNode('COMPONENT', page.id, {
      name: 'Button',
      width: 80,
      height: 32
    })
    store.graph.createNode('RECTANGLE', button.id, { width: 80, height: 32 })
    const instanceId = expectDefined(store.createInstanceFromComponent(button.id, 0, 0))
    const graph = deserializeGraph(structuredClone(serializeGraph(store.graph, '0.15.1')))
    expect(detachBrandInstances(graph)).toEqual({ detached: 0, nodeIds: [] })
    expect(graph.getNode(instanceId)?.type).toBe('INSTANCE')
  })

  test('a legacy instance named brand:* over one image child (no pluginData anywhere) is detached too', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const component = graph.createNode('COMPONENT', page.id, {
      name: 'brand:company-logo-light',
      width: 300,
      height: 100
    })
    graph.createNode('RECTANGLE', component.id, {
      width: 300,
      height: 100,
      fills: [
        {
          type: 'IMAGE',
          color: { r: 0, g: 0, b: 0, a: 1 },
          opacity: 1,
          visible: true,
          imageHash: 'logo',
          imageScaleMode: 'FIT'
        }
      ]
    })
    const instance = expectDefined(graph.createInstance(component.id, page.id, { x: 10, y: 10 }))
    expect(detachBrandInstances(graph).detached).toBe(1)
    const node = getNodeOrThrow(graph, instance.id)
    expect(node.type).toBe('RECTANGLE')
    expect(node.fills[0].imageScaleMode).toBe('FIT')
    expect(node.name).toBe('brand:company-logo-light')
  })
})

describe('Shape — Rectangle ⇄ Circle', () => {
  test('applies to brand:* and content image layers drawn as RECTANGLE / ELLIPSE, never to text or unbound layers', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const brand = store.graph.createNode('RECTANGLE', page.id, { name: 'brand:user-image:Hero' })
    const image = store.graph.createNode('ELLIPSE', page.id, { name: 'content:image' })
    const ai = store.graph.createNode('RECTANGLE', page.id, { name: 'content:ai-image' })
    const title = store.graph.createNode('TEXT', page.id, { name: 'content:title' })
    const plain = store.graph.createNode('RECTANGLE', page.id, { name: 'Background' })
    const frame = store.graph.createNode('FRAME', page.id, { name: 'brand:user-image' })
    expect(shapeControlApplies(brand)).toBe(true)
    expect(shapeControlApplies(image)).toBe(true)
    expect(shapeControlApplies(ai)).toBe(true)
    expect(shapeControlApplies(title)).toBe(false)
    expect(shapeControlApplies(plain)).toBe(false)
    expect(shapeControlApplies(frame)).toBe(false)
    expect(shapeControlApplies(null)).toBe(false)
  })

  test('Circle swaps the node to ELLIPSE in place — same id, name, fill, size, position, pluginData, opacity; Rectangle swaps back; one undo step each', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const id = expectDefined(insertBrandShape(store, component.id, 30, 40))
    store.updateNode(id, {
      opacity: 0.7,
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          radius: 4,
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 0, y: 2 }
        } as never
      ]
    })
    const before = { ...getNodeOrThrow(store.graph, id) }
    store.select([id])

    expect(setBrandShape(store, id, 'ELLIPSE')).toBe(true)
    const circle = getNodeOrThrow(store.graph, id)
    expect(circle.type).toBe('ELLIPSE')
    expect(circle.name).toBe(before.name)
    expect(circle.fills).toEqual(before.fills)
    expect({ x: circle.x, y: circle.y, width: circle.width, height: circle.height }).toEqual({
      x: 30,
      y: 40,
      width: 640,
      height: 480
    })
    expect(circle.pluginData).toEqual(before.pluginData)
    expect(circle.opacity).toBe(0.7)
    expect(circle.effects).toEqual(before.effects)
    expect([...store.state.selectedIds]).toEqual([id])

    // Already a circle: nothing to do, nothing pushed.
    expect(setBrandShape(store, id, 'ELLIPSE')).toBe(false)

    expect(setBrandShape(store, id, 'RECTANGLE')).toBe(true)
    expect(store.graph.getNode(id)?.type).toBe('RECTANGLE')

    store.undo.undo()
    expect(store.graph.getNode(id)?.type).toBe('ELLIPSE')
    store.undo.undo()
    expect(store.graph.getNode(id)?.type).toBe('RECTANGLE')
    store.undo.redo()
    expect(store.graph.getNode(id)?.type).toBe('ELLIPSE')
  })

  test('refuses a text layer or an unbound shape', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const title = store.graph.createNode('TEXT', page.id, { name: 'content:title' })
    const plain = store.graph.createNode('RECTANGLE', page.id, { name: 'Background' })
    expect(setBrandShape(store, title.id, 'ELLIPSE')).toBe(false)
    expect(setBrandShape(store, plain.id, 'ELLIPSE')).toBe(false)
    expect(store.graph.getNode(plain.id)?.type).toBe('RECTANGLE')
  })

  test('an ELLIPSE brand layer still reads as a brand binding and serialises with its IMAGE fill', () => {
    const store = makeStore()
    const component = publishInto(store, HERO)
    const id = expectDefined(insertBrandShape(store, component.id, 0, 0))
    setBrandShape(store, id, 'ELLIPSE')
    const saved = serializeGraph(store.graph, '0.15.1')
    const stored = saved.graph.nodes.find(([nodeId]) => nodeId === id)?.[1]
    expect(stored.type).toBe('ELLIPSE')
    expect(stored.name).toBe('brand:user-image:Hero')
    expect((stored.fills as Array<{ type: string; imageHash: string }>)[0].type).toBe('IMAGE')
    expect(bindingOf(getNodeOrThrow(store.graph, id), DEFAULT_VOCABULARY)?.kind).toBe('brand')
  })
})
