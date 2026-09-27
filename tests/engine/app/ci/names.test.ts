// CI: Track FB-65 — the Names tab's rows come from the payload, click copies,
// Rename selected layer is one undo step.
import { afterEach, describe, expect, test } from 'bun:test'

import type { StudioBindingsVocabulary, StudioBrandAsset } from '@/app/ci/api'
import { DEFAULT_VOCABULARY } from '@/app/ci/bindings'
import {
  BRAND_NAMED_ASSET_ROW,
  copyText,
  NAMES_COPY,
  namesGroups,
  renameSelectedLayer,
  renameStatusWords
} from '@/app/ci/names'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

import { expectDefined, getNodeOrThrow } from '#tests/helpers/assert'

const DESCRIBED: StudioBindingsVocabulary = {
  ...DEFAULT_VOCABULARY,
  descriptions: {
    'content:title': 'the hook / title',
    'content:subtitle': 'subtitle (demand name or topic)',
    'content:body': 'the body text; on a carousel the chunk for that slide',
    'content:cta': 'call to action',
    'content:article-url': 'the article link (text)',
    'content:image': "the source post's image (image fill)",
    'content:ai-image': 'reserved, placeholder today',
    'brand:user-image': 'your default user image',
    'brand:company-logo-light': 'light logo, for dark backgrounds',
    'brand:company-logo-dark': 'dark logo, for light backgrounds',
    'brand:<kind>:<asset name>': 'a named asset instead of the default',
    cover: 'required, the first / only image',
    repeat: 'one per body chunk on carousel formats',
    ending: 'optional last slide with the CTA'
  }
}

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

describe('namesGroups', () => {
  test('three groups in the vocabulary order — text → image → reserved, kinds → placeholder, roles — each row with its description', () => {
    const groups = namesGroups(DESCRIBED)
    expect(groups.map((g) => [g.key, g.heading])).toEqual([
      ['content', 'Content'],
      ['brand', 'Brand'],
      ['frames', 'Frames']
    ])
    const [content, brand, frames] = groups
    expect(expectDefined(content).rows.map((r) => r.name)).toEqual([
      'content:title',
      'content:subtitle',
      'content:body',
      'content:cta',
      'content:article-url',
      'content:image',
      'content:ai-image'
    ])
    expect(expectDefined(brand).rows.map((r) => r.name)).toEqual([
      'brand:user-image',
      'brand:company-logo-light',
      'brand:company-logo-dark',
      BRAND_NAMED_ASSET_ROW
    ])
    expect(expectDefined(frames).rows.map((r) => r.name)).toEqual(['cover', 'repeat', 'ending'])
    for (const group of groups)
      for (const row of group.rows)
        expect(row.description, row.name).toBe(DESCRIBED.descriptions?.[row.name] ?? null)
    const placeholder = expectDefined(brand).rows.at(-1)
    expect(placeholder?.kind).toBe('brand-placeholder')
    expect(placeholder?.renamable).toBe(false)
    expect(placeholder?.sub).toBe(false)
  })

  test("the workspace's assets are sub-rows under the placeholder, in gallery order, named by their binding", () => {
    const brand = expectDefined(namesGroups(DESCRIBED, [HERO, MARK])[1])
    const tail = brand.rows.slice(-3)
    expect(tail.map((r) => [r.name, r.kind, r.sub, r.renamable])).toEqual([
      [BRAND_NAMED_ASSET_ROW, 'brand-placeholder', false, false],
      ['brand:user-image:Hero', 'brand-asset', true, true],
      ['brand:company-logo-dark:Mark', 'brand-asset', true, true]
    ])
    expect(tail[1]?.description).toBe('Hero · user image (default)')
    expect(tail[2]?.description).toBe('Mark · dark logo')
  })

  test('an asset of a kind the vocabulary does not list is skipped', () => {
    const odd = { ...HERO, kind: 'favicon' as StudioBrandAsset['kind'] }
    const brand = expectDefined(namesGroups(DESCRIBED, [odd])[1])
    expect(brand.rows.some((r) => r.kind === 'brand-asset')).toBe(false)
  })

  test('a name without a description keeps its row, description null — an older app describes nothing', () => {
    const partial: StudioBindingsVocabulary = {
      ...DEFAULT_VOCABULARY,
      contentText: [...DEFAULT_VOCABULARY.contentText, 'kicker'],
      descriptions: { 'content:title': 'the hook / title', 'content:kicker': '   ' }
    }
    const content = expectDefined(namesGroups(partial)[0])
    const kicker = content.rows.find((r) => r.name === 'content:kicker')
    expect(kicker).toBeDefined()
    expect(kicker?.description).toBeNull()
    expect(content.rows.find((r) => r.name === 'content:body')?.description).toBeNull()

    const old = namesGroups(DEFAULT_VOCABULARY)
    expect(old.flatMap((g) => g.rows).every((r) => r.description === null)).toBe(true)
    expect(old.flatMap((g) => g.rows).map((r) => r.name)).toContain('cover')
  })

  test('new vocabulary entries appear without a fork change', () => {
    const grown: StudioBindingsVocabulary = {
      ...DESCRIBED,
      reserved: ['ai-image', 'ai-video'],
      brandKinds: [...DEFAULT_VOCABULARY.brandKinds, 'pattern'],
      roles: ['cover', 'repeat', 'ending', 'closing'],
      descriptions: { ...DESCRIBED.descriptions, 'content:ai-video': 'reserved', closing: 'last' }
    }
    const [content, brand, frames] = namesGroups(grown)
    expect(content?.rows.at(-1)?.name).toBe('content:ai-video')
    expect(brand?.rows.map((r) => r.name)).toContain('brand:pattern')
    expect(frames?.rows.at(-1)).toMatchObject({ name: 'closing', description: 'last' })
  })
})

describe('copyText', () => {
  test('the async clipboard first', async () => {
    const written: string[] = []
    const ok = await copyText('content:title', {
      writeText: async (t) => {
        written.push(t)
      },
      legacyCopy: () => {
        throw new Error('not reached')
      }
    })
    expect(ok).toBe(true)
    expect(written).toEqual(['content:title'])
  })

  test('falls back to the textarea path when the async API is missing or refuses', async () => {
    const legacy: string[] = []
    const env = {
      legacyCopy: (t: string) => {
        legacy.push(t)
        return true
      }
    }
    expect(await copyText('cover', { writeText: null, ...env })).toBe(true)
    expect(
      await copyText('repeat', {
        writeText: async () => {
          throw new DOMException('denied', 'NotAllowedError')
        },
        ...env
      })
    ).toBe(true)
    expect(legacy).toEqual(['cover', 'repeat'])
    expect(await copyText('ending', { writeText: null, legacyCopy: () => false })).toBe(false)
    expect(await copyText('ending', { writeText: null })).toBe(false)
  })
})

describe('renameSelectedLayer', () => {
  const stores: EditorStore[] = []
  function makeStore(): EditorStore {
    const store = createEditorStore()
    stores.push(store)
    return store
  }
  afterEach(() => {
    for (const store of stores.splice(0)) store.dispose()
  })

  test('renames the ONE selected layer through the undoable update — one undo step, selection kept', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const cover = store.graph.createNode('FRAME', page.id, { name: 'cover', width: 10, height: 10 })
    const text = store.graph.createNode('TEXT', cover.id, { name: 'Headline' })
    store.select([text.id])
    const before = store.undo.canUndo

    const result = renameSelectedLayer(store, 'content:title')
    expect(result).toEqual({ nodeId: text.id, several: false })
    expect(getNodeOrThrow(store.graph, text.id).name).toBe('content:title')
    expect([...store.state.selectedIds]).toEqual([text.id])
    expect(renameStatusWords(expectDefined(result), 'content:title')).toBe(
      NAMES_COPY.renamed('content:title')
    )

    expect(store.undo.canUndo).toBe(true)
    expect(store.undo.undoLabel).toBe(NAMES_COPY.renameUndo)
    store.undo.undo()
    expect(getNodeOrThrow(store.graph, text.id).name).toBe('Headline')
    expect(store.undo.canUndo).toBe(before)
    store.undo.redo()
    expect(getNodeOrThrow(store.graph, text.id).name).toBe('content:title')
  })

  test('several selected → the first one takes the name and the words say so; nothing selected → null', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const a = store.graph.createNode('RECTANGLE', page.id, { name: 'A' })
    const b = store.graph.createNode('RECTANGLE', page.id, { name: 'B' })
    store.select([a.id, b.id])

    const result = renameSelectedLayer(store, 'brand:user-image')
    expect(result).toEqual({ nodeId: a.id, several: true })
    expect(getNodeOrThrow(store.graph, a.id).name).toBe('brand:user-image')
    expect(getNodeOrThrow(store.graph, b.id).name).toBe('B')
    expect(renameStatusWords(expectDefined(result), 'brand:user-image')).toBe(
      NAMES_COPY.renamedFirst('brand:user-image')
    )

    store.select([])
    expect(renameSelectedLayer(store, 'cover')).toBeNull()
  })

  test('the same name again writes no undo entry', () => {
    const store = makeStore()
    const page = store.graph.getPages()[0]
    const a = store.graph.createNode('RECTANGLE', page.id, { name: 'content:image' })
    store.select([a.id])
    const before = store.undo.canUndo
    expect(renameSelectedLayer(store, 'content:image')).toEqual({ nodeId: a.id, several: false })
    expect(store.undo.canUndo).toBe(before)
  })
})
