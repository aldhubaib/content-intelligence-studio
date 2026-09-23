// CI: binding model v3 read from a live graph (Track E3d-a, FB-44).
import { describe, expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import type { StudioFormat } from '@/app/ci/api'
import {
  addRoleFrame,
  bindingName,
  bindingOf,
  bindingsReport,
  bindingsStatusWords,
  DEFAULT_VOCABULARY,
  listBindings,
  migrateLegacyBindings,
  nextRoleFramePosition,
  parseBindingName,
  roleFrames,
  roleOfFrameName,
  roleStatusWords
} from '@/app/ci/bindings'
import { createEditorStore } from '@/app/editor/session'

const FORMAT: StudioFormat = {
  id: 'instagram_post',
  label: 'Instagram post',
  platform: 'INSTAGRAM',
  width: 1080,
  height: 1350,
  aspect: '4:5',
  safeInsetPct: [4, 4, 12, 4],
  slideCap: 1
}
const CAROUSEL: StudioFormat = {
  ...FORMAT,
  id: 'instagram_carousel',
  label: 'Instagram carousel',
  slideCap: 10
}

describe('parseBindingName', () => {
  test('content: and brand: names, case-insensitive prefixes, legacy slot: mapped', () => {
    expect(parseBindingName('content:title', DEFAULT_VOCABULARY)).toEqual({
      kind: 'content',
      slot: 'title'
    })
    expect(parseBindingName('Content:Title', DEFAULT_VOCABULARY)).toEqual({
      kind: 'content',
      slot: 'title'
    })
    expect(parseBindingName('brand:user-image', DEFAULT_VOCABULARY)).toEqual({
      kind: 'brand',
      slotKind: 'user-image',
      name: null
    })
    expect(parseBindingName('brand:user-image:Hero shot', DEFAULT_VOCABULARY)).toEqual({
      kind: 'brand',
      slotKind: 'user-image',
      name: 'Hero shot'
    })
    expect(parseBindingName('slot:headline', DEFAULT_VOCABULARY)).toEqual({
      kind: 'content',
      slot: 'title'
    })
    expect(parseBindingName('slot:cover', DEFAULT_VOCABULARY)).toEqual({
      kind: 'content',
      slot: 'image'
    })
    expect(parseBindingName('slot:quote', DEFAULT_VOCABULARY)).toEqual({
      kind: 'content',
      slot: 'body'
    })
    expect(parseBindingName('content:banana', DEFAULT_VOCABULARY)).toBeNull()
    expect(parseBindingName('brand:mystery', DEFAULT_VOCABULARY)).toBeNull()
    expect(parseBindingName('Headline', DEFAULT_VOCABULARY)).toBeNull()
  })

  test('the layer name is authoritative; the plugin slot value is only a fallback', () => {
    expect(
      bindingOf(
        {
          name: 'content:body',
          pluginData: [{ pluginId: 'content-intelligence', key: 'slot', value: 'headline' }]
        },
        DEFAULT_VOCABULARY
      )
    ).toEqual({ kind: 'content', slot: 'body' })
    expect(
      bindingOf(
        {
          name: 'Headline',
          pluginData: [{ pluginId: 'content-intelligence', key: 'slot', value: 'headline' }]
        },
        DEFAULT_VOCABULARY
      )
    ).toEqual({ kind: 'content', slot: 'title' })
    expect(bindingName({ kind: 'brand', slotKind: 'company-logo-dark', name: 'Mark' })).toBe(
      'brand:company-logo-dark:Mark'
    )
  })

  test('role frames are read by name, case-insensitive, first wins', () => {
    expect(roleOfFrameName('Cover')).toBe('cover')
    expect(roleOfFrameName(' repeat ')).toBe('repeat')
    expect(roleOfFrameName('Portrait')).toBeNull()
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, { name: 'Cover', width: 10, height: 10 })
    graph.createNode('FRAME', page.id, { name: 'cover', width: 10, height: 10 })
    graph.createNode('FRAME', page.id, { name: 'Ending', width: 10, height: 10 })
    const roles = roleFrames(graph)
    expect(roles.map((r) => [r.role, r.name])).toEqual([
      ['cover', 'Cover'],
      ['ending', 'Ending']
    ])
  })
})

describe('bindingsReport', () => {
  function graphWith(build: (graph: SceneGraph, pageId: string) => void): SceneGraph {
    const graph = new SceneGraph()
    build(graph, graph.getPages()[0].id)
    return graph
  }

  test('a cover with a text and an image is usable for a single-image format', () => {
    const graph = graphWith((g, page) => {
      const cover = g.createNode('FRAME', page, { name: 'cover', width: 1080, height: 1350 })
      g.createNode('TEXT', cover.id, { name: 'content:title' })
      g.createNode('RECTANGLE', cover.id, { name: 'content:image' })
      g.createNode('RECTANGLE', cover.id, { name: 'brand:company-logo-light' })
    })
    const report = bindingsReport(graph, DEFAULT_VOCABULARY, FORMAT)
    expect(report.version).toBe('bindings-v3')
    expect(report.usable).toEqual({ single: true, carousel: false })
    expect(bindingsStatusWords(report.roles)).toBe('Usable')
    const cover = report.roles.find((r) => r.role === 'cover')
    expect(cover?.status).toBe('ok')
    expect(cover?.bindings.map((b) => b.name)).toEqual([
      'content:title',
      'content:image',
      'brand:company-logo-light'
    ])
    expect(cover && roleStatusWords(cover)).toBe('Cover · OK')
    const ending = report.roles.find((r) => r.role === 'ending')
    expect(ending && roleStatusWords(ending)).toBe('Ending · not added')
    expect(listBindings(graph, DEFAULT_VOCABULARY)).toHaveLength(3)
  })

  test('no cover frame → not usable; a repeat without content:body says so', () => {
    const none = bindingsReport(
      graphWith((g, page) => {
        const frame = g.createNode('FRAME', page, { name: 'Portrait', width: 1080, height: 1350 })
        g.createNode('TEXT', frame.id, { name: 'content:title' })
      }),
      DEFAULT_VOCABULARY,
      FORMAT
    )
    expect(none.usable.single).toBe(false)
    expect(bindingsStatusWords(none.roles)).toBe('Not usable yet — there is no cover frame')

    const carousel = bindingsReport(
      graphWith((g, page) => {
        const cover = g.createNode('FRAME', page, { name: 'cover', width: 1080, height: 1350 })
        g.createNode('TEXT', cover.id, { name: 'content:title' })
        const repeat = g.createNode('FRAME', page, {
          name: 'repeat',
          x: 1200,
          width: 1080,
          height: 1350
        })
        g.createNode('TEXT', repeat.id, { name: 'content:title' })
      }),
      DEFAULT_VOCABULARY,
      CAROUSEL
    )
    expect(carousel.usable).toEqual({ single: true, carousel: false })
    const repeat = carousel.roles.find((r) => r.role === 'repeat')
    expect(repeat?.present).toBe(true)
    expect(repeat && roleStatusWords(repeat)).toBe('Repeat · repeat has no content:body')
  })

  test('duplicates, text on a shape and an image on a text are warnings, never a gate', () => {
    const report = bindingsReport(
      graphWith((g, page) => {
        const cover = g.createNode('FRAME', page, { name: 'cover', width: 1080, height: 1350 })
        g.createNode('TEXT', cover.id, { name: 'content:title' })
        g.createNode('TEXT', cover.id, { name: 'content:title' })
        g.createNode('RECTANGLE', cover.id, { name: 'content:body' })
        g.createNode('TEXT', cover.id, { name: 'content:image' })
        g.createNode('TEXT', page, { name: 'content:cta' })
      }),
      DEFAULT_VOCABULARY,
      FORMAT
    )
    const cover = report.roles.find((r) => r.role === 'cover')
    expect(cover?.status).toBe('ok')
    expect(cover?.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['duplicate_binding', 'text_on_shape', 'image_on_text'])
    )
    expect(report.strayBindings.map((b) => b.name)).toEqual(['content:cta'])
  })
})

describe('migrateLegacyBindings', () => {
  test('renames slot: layers to content: names and names the first artboard cover, once', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const frame = graph.createNode('FRAME', page.id, {
      name: 'Portrait',
      width: 1080,
      height: 1350
    })
    graph.createNode('RECTANGLE', frame.id, { name: 'slot:cover' })
    graph.createNode('TEXT', frame.id, { name: 'slot:headline' })
    graph.createNode('TEXT', frame.id, { name: 'slot:attribution' })
    graph.createNode('TEXT', frame.id, { name: 'Plain text' })
    const update = (id: string, changes: Partial<{ name: string }>) => graph.updateNode(id, changes)

    const first = migrateLegacyBindings(graph, update, DEFAULT_VOCABULARY)
    expect(first).toEqual({ renamedLayers: 3, roleFrameNamed: true, changed: true })
    expect(graph.getNode(frame.id)?.name).toBe('cover')
    expect(
      graph
        .getChildren(frame.id)
        .map((n) => n.name)
        .sort()
    ).toEqual(['Plain text', 'content:image', 'content:subtitle', 'content:title'])

    const second = migrateLegacyBindings(graph, update, DEFAULT_VOCABULARY)
    expect(second).toEqual({ renamedLayers: 0, roleFrameNamed: false, changed: false })
  })

  test('an existing role frame is left alone and the document root is never renamed', () => {
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    graph.createNode('FRAME', page.id, { name: 'Ending', width: 10, height: 10 })
    const rootName = graph.getNode(graph.rootId)?.name
    const report = migrateLegacyBindings(
      graph,
      (id, c) => graph.updateNode(id, c),
      DEFAULT_VOCABULARY
    )
    expect(report.changed).toBe(false)
    expect(graph.getNode(graph.rootId)?.name).toBe(rootName)
  })
})

describe('addRoleFrame', () => {
  test('creates a correctly named frame at the format size to the right of the last frame; refuses a duplicate', () => {
    const store = createEditorStore()
    const page = store.state.currentPageId
    store.graph.createNode('FRAME', page, { name: 'cover', x: 0, y: 0, width: 1080, height: 1350 })
    expect(nextRoleFramePosition(store.graph, page)).toEqual({ x: 1200, y: 0 })

    const repeat = addRoleFrame(store, 'repeat', FORMAT)
    expect(repeat).not.toBeNull()
    const node = repeat ? store.graph.getNode(repeat) : undefined
    expect(node?.name).toBe('repeat')
    expect([node?.x, node?.y, node?.width, node?.height]).toEqual([1200, 0, 1080, 1350])
    expect(node?.parentId).toBe(page)
    expect([...store.state.selectedIds]).toEqual([repeat])

    expect(addRoleFrame(store, 'repeat', FORMAT)).toBeNull()
    expect(roleFrames(store.graph, page).map((r) => r.role)).toEqual(['cover', 'repeat'])
  })
})
