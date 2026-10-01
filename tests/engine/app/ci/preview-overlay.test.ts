// CI: Preview with real content — the overlay over a real editor store (Track E3d-b1, FB-44 §6).
//
// The one property every test here defends: what a person previews with
// NEVER reaches a saved document. `overlay.serialize()` is byte-equal to the
// document without the overlay, no edit is recorded, nothing is dirty.
import { afterEach, describe, expect, test } from 'bun:test'

import { copyFills, SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import type { StudioBrandAsset, StudioPreviewCandidate, StudioPreviewContent } from '@/app/ci/api'
import { DEFAULT_VOCABULARY } from '@/app/ci/bindings'
import { serializeGraph } from '@/app/ci/document'
import { createPreviewOverlay, type PreviewOverlay } from '@/app/ci/preview-overlay'
import { createEditorStore, type EditorStore } from '@/app/editor/session'

const ENGINE = '0.15.1'

const SAMPLE: StudioPreviewContent = {
  title: 'عنوان تجريبي',
  subtitle: 'سطر ثانٍ',
  body: 'نص تجريبي يملأ الصندوق بكلمات كثيرة حتى نرى كيف يبدو القالب مع محتوى حقيقي وطويل نسبياً في المعاينة',
  cta: 'اعرف أكثر',
  articleUrl: 'https://example.invalid/articles/preview'
}

const CANDIDATE: StudioPreviewCandidate = {
  id: 'cand-1',
  title: 'ثلاث عادات تغيّر يومك',
  subtitle: 'Weekly LinkedIn insight',
  body: 'الجملة الأولى من المرشّح. والجملة الثانية أطول قليلاً لتُظهر الالتفاف. وثالثة تكمل الفقرة حتى النهاية.',
  cta: 'اقرأ المقال',
  articleUrl: 'https://nizek.example/articles/three-habits',
  format: 'LINKEDIN_POST',
  formatLabel: 'LinkedIn Post',
  approvedAt: '2026-09-23T10:00:00Z',
  imageUrl: 'https://app.example.com/api/studio/templates/tpl-1/preview-candidates/cand-1/image'
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
const PNG_2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9])
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7, 8])

function asset(
  id: string,
  kind: StudioBrandAsset['kind'],
  isDefault: boolean,
  name = id
): StudioBrandAsset {
  return {
    id,
    name,
    url: `https://app.example.com/assets/${id}`,
    kind,
    isDefault,
    contentType: 'image/png'
  }
}

interface Fixture {
  store: EditorStore
  overlay: PreviewOverlay
  /** Track E3d-c: node ids whose text edit the locked overlay refused. */
  refused: string[]
  ids: Record<
    | 'title'
    | 'body'
    | 'image'
    | 'brand'
    | 'repeatBody'
    | 'cover'
    | 'repeat'
    | 'displayName'
    | 'handle',
    string
  >
  /** The document before any preview — every save must equal it. */
  before: string
  loads: string[]
  /** Track FB-69: the kind the locked overlay reported with each refusal. */
  refusedKinds: string[]
}

/** Track FB-69: the kit's brand text as the app's payload carries it. */
const BRAND_TEXT = { 'display-name': 'Nizek', handle: '@nizek' }

function settle(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

let fixture: Fixture | null = null

afterEach(() => {
  fixture?.overlay.dispose()
  fixture?.store.dispose()
  fixture = null
})

function build(
  options: {
    withImage?: boolean
    lock?: boolean
    preferredUserImage?: string | null
    /** Track FB-69: `payload.brand.text`; `undefined` = an older app that sends none. */
    brandText?: Record<string, string> | null
  } = {}
): Fixture {
  const store = createEditorStore()
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const cover = graph.createNode('FRAME', page.id, {
    name: 'cover',
    x: 0,
    y: 0,
    width: 1080,
    height: 1350
  })
  const title = graph.createNode('TEXT', cover.id, {
    name: 'content:title',
    text: 'Title placeholder',
    styleRuns: [{ start: 0, length: 17, style: { fontWeight: 700 } }],
    width: 900,
    height: 120,
    fontSize: 48
  })
  const body = graph.createNode('TEXT', cover.id, {
    name: 'content:body',
    text: 'Body placeholder',
    width: 900,
    height: 600,
    fontSize: 28
  })
  const image = graph.createNode('RECTANGLE', cover.id, {
    name: 'content:image',
    width: 1080,
    height: 700
  })
  const brand = graph.createNode('RECTANGLE', cover.id, {
    name: 'brand:user-image',
    width: 400,
    height: 400
  })
  // Track FB-69: the two brand TEXT layers with their seed placeholders (a quote-card template).
  const displayName = graph.createNode('TEXT', cover.id, {
    name: 'brand:display-name',
    text: 'Your name',
    styleRuns: [{ start: 0, length: 9, style: { fontWeight: 600 } }],
    width: 600,
    height: 60,
    fontSize: 32
  })
  const handle = graph.createNode('TEXT', cover.id, {
    name: 'Brand:Handle',
    text: '@yourhandle',
    width: 600,
    height: 40,
    fontSize: 24
  })
  const repeat = graph.createNode('FRAME', page.id, {
    name: 'repeat',
    x: 1200,
    y: 0,
    width: 1080,
    height: 1350
  })
  const repeatBody = graph.createNode('TEXT', repeat.id, {
    name: 'content:body',
    text: 'Body placeholder',
    width: 200,
    height: 40,
    fontSize: 20
  })
  store.replaceGraph(graph)
  store.setDocumentSource(store.state.documentName, 'ci-hosted')
  const before = JSON.stringify(serializeGraph(store.graph, ENGINE))
  const loads: string[] = []
  const refused: string[] = []
  const refusedKinds: string[] = []
  const overlay = createPreviewOverlay(store, {
    vocabulary: () => DEFAULT_VOCABULARY,
    sampleText: () => SAMPLE,
    brandText: options.brandText === undefined ? undefined : () => options.brandText ?? null,
    lockContentText: options.lock ? () => true : undefined,
    onLockedEdit: (id, kind) => {
      refused.push(id)
      refusedKinds.push(kind)
    },
    preferredBrandAsset: options.preferredUserImage
      ? (kind) => (kind === 'user-image' ? (options.preferredUserImage ?? null) : null)
      : undefined,
    loadImage: options.withImage
      ? async (url) => {
          loads.push(url)
          return JPG
        }
      : undefined,
    log: () => undefined
  })
  fixture = {
    store,
    overlay,
    refused,
    refusedKinds,
    ids: {
      title: title.id,
      body: body.id,
      image: image.id,
      brand: brand.id,
      repeatBody: repeatBody.id,
      cover: cover.id,
      repeat: repeat.id,
      displayName: displayName.id,
      handle: handle.id
    },
    before,
    loads
  }
  return fixture
}

function node(store: EditorStore, id: string): SceneNode {
  const found = store.graph.getNode(id)
  if (!found) throw new Error(`node ${id} missing`)
  return found
}

function saved(overlay: PreviewOverlay): string {
  return JSON.stringify(overlay.serialize(ENGINE))
}

describe('content preview', () => {
  test('the sample paints the bound text layers; nothing is an edit', () => {
    const { store, overlay, ids, before } = build()
    overlay.setContent({ kind: 'sample' })

    expect(node(store, ids.title).text).toBe(SAMPLE.title)
    expect(node(store, ids.title).styleRuns).toEqual([
      { start: 0, length: SAMPLE.title.length, style: { fontWeight: 700 } }
    ])
    expect(node(store, ids.body).text).toBe(SAMPLE.body)
    // The repeat frame shows the first chunk that fits its small box.
    const chunk = node(store, ids.repeatBody).text
    expect(chunk.endsWith('…')).toBe(true)
    expect(chunk.length).toBeLessThan(SAMPLE.body.length)
    // Boxes and fonts stay.
    expect(node(store, ids.title).width).toBe(900)
    expect(node(store, ids.title).fontSize).toBe(48)
    // No image without a candidate.
    expect(node(store, ids.image).fills).toEqual(store.graph.getNode(ids.image)?.fills ?? [])
    expect(overlay.isPreviewed(ids.title)).toBe(true)
    expect(overlay.isPreviewed(ids.image)).toBe(false)

    expect(store.hasUnsavedChanges()).toBe(false)
    expect(store.undo.canUndo).toBe(false)
    expect(saved(overlay)).toBe(before)
  })

  test('a candidate replaces the sample; None restores every layer exactly', () => {
    const { store, overlay, ids, before } = build()
    overlay.setContent({ kind: 'sample' })
    overlay.setContent({ kind: 'candidate', candidate: CANDIDATE })
    expect(node(store, ids.title).text).toBe(CANDIDATE.title)
    expect(node(store, ids.body).text).toBe(CANDIDATE.body)
    expect(saved(overlay)).toBe(before)

    overlay.setContent({ kind: 'none' })
    expect(node(store, ids.title).text).toBe('Title placeholder')
    expect(node(store, ids.title).styleRuns).toEqual([
      { start: 0, length: 17, style: { fontWeight: 700 } }
    ])
    expect(node(store, ids.body).text).toBe('Body placeholder')
    expect(overlay.isPreviewed(ids.title)).toBe(false)
    expect(JSON.stringify(serializeGraph(store.graph, ENGINE))).toBe(before)
    expect(store.hasUnsavedChanges()).toBe(false)
  })

  test('a selected text layer keeps the preview', () => {
    const { store, overlay, ids } = build()
    overlay.setContent({ kind: 'sample' })
    store.select([ids.title])
    expect(node(store, ids.title).text).toBe(SAMPLE.title)
    expect(overlay.isPreviewed(ids.title)).toBe(true)
    expect(node(store, ids.body).text).toBe(SAMPLE.body)
    store.select([])
    expect(node(store, ids.title).text).toBe(SAMPLE.title)
  })

  test('an edit made while selected becomes the new original; the preview never leaks into it', () => {
    const { store, overlay, ids } = build()
    overlay.setContent({ kind: 'sample' })
    store.select([ids.title])
    store.updateNodeWithUndo(ids.title, { text: 'New placeholder' }, 'Edit text')
    store.select([])
    expect(node(store, ids.title).text).toBe(SAMPLE.title)
    expect(store.hasUnsavedChanges()).toBe(true)
    expect(store.undo.canUndo).toBe(true)

    const doc = overlay.serialize(ENGINE)
    expect(doc.graph.nodes.find(([id]) => id === ids.title)?.[1].text).toBe('New placeholder')
    expect(JSON.stringify(doc)).not.toContain(SAMPLE.title)

    // Undo lands on the document value; the selected layer keeps showing the preview.
    store.select([ids.title])
    store.undo.undo()
    expect(node(store, ids.title).text).toBe(SAMPLE.title)
    store.select([])
    expect(node(store, ids.title).text).toBe(SAMPLE.title)
    overlay.setContent({ kind: 'none' })
    expect(node(store, ids.title).text).toBe('Title placeholder')
  })

  test('a layer renamed away from its binding drops the preview; renamed into one picks it up', () => {
    const { store, overlay, ids, before } = build()
    overlay.setContent({ kind: 'sample' })
    store.updateNodeWithUndo(ids.title, { name: 'Headline' }, 'Rename')
    expect(node(store, ids.title).text).toBe('Title placeholder')
    expect(overlay.isPreviewed(ids.title)).toBe(false)

    store.updateNodeWithUndo(ids.title, { name: 'content:subtitle' }, 'Rename')
    expect(node(store, ids.title).text).toBe(SAMPLE.subtitle)
    store.updateNodeWithUndo(ids.title, { name: 'content:title' }, 'Rename')
    expect(node(store, ids.title).text).toBe(SAMPLE.title)

    // Only the renames are edits; the saved layer keeps its own words.
    const doc = overlay.serialize(ENGINE)
    const title = doc.graph.nodes.find(([id]) => id === ids.title)?.[1]
    if (!title) throw new Error('expected the title in the document')
    expect(title.text).toBe('Title placeholder')
    expect((title.source as { editedFields: string[] }).editedFields).toEqual(['name'])
    expect(JSON.stringify(doc)).not.toContain(SAMPLE.title)
    expect(JSON.stringify(doc)).not.toContain(SAMPLE.subtitle)
    expect(before).toContain('"Title placeholder"')
  })

  test('undo of a delete and a duplicate come back with document values, not preview words', () => {
    const { store, overlay, ids } = build()
    overlay.setContent({ kind: 'sample' })

    store.select([ids.title])
    store.deleteSelected()
    expect(store.graph.getNode(ids.title)).toBeUndefined()
    store.undo.undo()
    store.select([])
    expect(node(store, ids.title).text).toBe(SAMPLE.title)
    const afterUndo = overlay.serialize(ENGINE)
    const title = afterUndo.graph.nodes.find(([id]) => id === ids.title)?.[1]
    expect(title?.text).toBe('Title placeholder')
    expect(title?.styleRuns).toEqual([{ start: 0, length: 17, style: { fontWeight: 700 } }])
    // The recreated layer carries no edit mark from the correction.
    expect((title?.source as { editedFields?: string[] } | undefined)?.editedFields ?? []).toEqual(
      []
    )
    expect(JSON.stringify(afterUndo)).not.toContain(SAMPLE.title)

    // ⌘D on the cover frame clones its (unselected, previewed) children.
    store.select([ids.cover])
    store.duplicateSelected()
    const coverCopy = [...store.graph.getAllNodes()].find((n) => n.name === 'cover copy')
    if (!coverCopy) throw new Error('expected a duplicate frame')
    const copies = [...store.graph.getAllNodes()].filter(
      (n) => n.parentId === coverCopy.id && n.name.startsWith('content:')
    )
    expect(copies.length).toBeGreaterThanOrEqual(2)
    const doc = overlay.serialize(ENGINE)
    for (const copy of copies) {
      const plain = doc.graph.nodes.find(([id]) => id === copy.id)?.[1]
      if (copy.type === 'TEXT') expect(plain?.text).toMatch(/placeholder$/)
    }
    expect(JSON.stringify(doc)).not.toContain(SAMPLE.body)
    expect(JSON.stringify(doc)).not.toContain(SAMPLE.title)
  })

  test('a candidate image fills content:image through the engine image store and is pruned from the save', async () => {
    const { store, overlay, ids, before, loads } = build({ withImage: true })
    overlay.setContent({ kind: 'candidate', candidate: CANDIDATE })
    await settle()
    expect(loads).toEqual([CANDIDATE.imageUrl])
    const hash = computeImageHash(JPG)
    expect(node(store, ids.image).fills?.[0]).toMatchObject({
      type: 'IMAGE',
      imageHash: hash,
      imageScaleMode: 'FILL'
    })
    expect(store.graph.images.has(hash)).toBe(true)

    const doc = overlay.serialize(ENGINE)
    expect(doc.graph.images.some(([h]) => h === hash)).toBe(false)
    expect(JSON.stringify(doc)).toBe(before)

    overlay.setContent({ kind: 'none' })
    expect(node(store, ids.image).fills?.some((f) => f.imageHash === hash)).toBe(false)
  })
})

describe('brand preview', () => {
  test("a brand layer previews the binding's default, a chosen asset, then the default again", () => {
    const { store, overlay, ids, before } = build()
    const hero = asset('hero', 'user-image', true, 'Hero')
    const alt = asset('alt', 'user-image', false, 'Alt')
    overlay.setBrandAssets([
      { asset: hero, bytes: PNG },
      { asset: alt, bytes: PNG_2 }
    ])
    expect(node(store, ids.brand).fills?.[0]).toMatchObject({
      type: 'IMAGE',
      imageHash: computeImageHash(PNG)
    })
    expect(overlay.brandAssetFor(ids.brand)?.id).toBe('hero')
    expect(saved(overlay)).toBe(before)

    overlay.setBrandChoice(ids.brand, 'alt')
    expect(node(store, ids.brand).fills?.[0]).toMatchObject({ imageHash: computeImageHash(PNG_2) })
    expect(overlay.brandAssetFor(ids.brand)?.id).toBe('alt')
    expect(saved(overlay)).toBe(before)

    overlay.setBrandChoice(ids.brand, null)
    expect(node(store, ids.brand).fills?.[0]).toMatchObject({ imageHash: computeImageHash(PNG) })
    expect(store.hasUnsavedChanges()).toBe(false)
    expect(store.undo.canUndo).toBe(false)
  })

  test('a document fill written with a preview hash is corrected back to the document', () => {
    const { store, overlay, ids, before } = build()
    overlay.setBrandAssets([{ asset: asset('hero', 'user-image', true), bytes: PNG }])
    const previewFills = copyFills([...node(store, ids.brand).fills])
    // Something copies the LIVE fills back into the document (a "commit" of what it sees).
    store.updateNodeWithUndo(ids.brand, { fills: previewFills }, 'Set fill')
    expect(JSON.stringify(overlay.serialize(ENGINE))).not.toContain(computeImageHash(PNG))
    // The live node keeps showing the preview; the document did not gain the image.
    expect(node(store, ids.brand).fills?.[0]?.imageHash).toBe(computeImageHash(PNG))
    const doc = overlay.serialize(ENGINE)
    const plain = doc.graph.nodes.find(([id]) => id === ids.brand)?.[1]
    expect(JSON.stringify(plain?.fills)).toBe(
      JSON.stringify(
        JSON.parse(before).graph.nodes.find(([id]: [string]) => id === ids.brand)[1].fills
      )
    )
  })

  test('dispose lifts everything', () => {
    const { store, overlay, ids, before } = build()
    overlay.setBrandAssets([{ asset: asset('hero', 'user-image', true), bytes: PNG }])
    overlay.setContent({ kind: 'sample' })
    overlay.dispose()
    expect(node(store, ids.title).text).toBe('Title placeholder')
    expect(node(store, ids.brand).fills?.some((f) => f.type === 'IMAGE')).toBe(false)
    expect(JSON.stringify(serializeGraph(store.graph, ENGINE))).toBe(before)
  })
})

describe('design mode — locked content text (Track E3d-c)', () => {
  test('a selected locked layer keeps showing the post; a text write is put back and reported', () => {
    const { store, overlay, ids, before, refused } = build({ lock: true })
    overlay.setContent({ kind: 'candidate', candidate: CANDIDATE })
    expect(node(store, ids.title).text).toBe(CANDIDATE.title)
    expect(overlay.isLocked(ids.title)).toBe(true)
    expect(overlay.isLocked(ids.image)).toBe(false)
    expect(overlay.isLocked(ids.brand)).toBe(false)

    // Selecting the layer does not lift the preview.
    store.select([ids.title])
    expect(node(store, ids.title).text).toBe(CANDIDATE.title)

    // A write that lands anyway is refused: the layer shows the post again, the document is the placeholder.
    store.updateNode(ids.title, { text: 'my own words' })
    expect(refused).toEqual([ids.title])
    expect(node(store, ids.title).text).toBe(CANDIDATE.title)
    expect(saved(overlay)).toBe(before)
    expect(JSON.parse(saved(overlay))).toEqual(JSON.parse(before))
  })

  test('a box or name change on a locked layer is still an edit; images stay editable', () => {
    const { store, overlay, ids, refused } = build({ lock: true })
    overlay.setContent({ kind: 'candidate', candidate: CANDIDATE })
    store.updateNode(ids.title, { width: 800 })
    expect(refused).toEqual([])
    expect(node(store, ids.title).width).toBe(800)
    store.updateNode(ids.image, { width: 500 })
    expect(node(store, ids.image).width).toBe(500)
    expect(refused).toEqual([])
  })

  test("without the lock the same write is adopted as the layer's new text", () => {
    const { store, overlay, ids, refused } = build()
    overlay.setContent({ kind: 'candidate', candidate: CANDIDATE })
    store.select([ids.title])
    store.updateNodeWithUndo(ids.title, { text: 'my own words' }, 'Edit text')
    expect(refused).toEqual([])
    expect(node(store, ids.title).text).toBe(CANDIDATE.title)
    expect(overlay.serialize(ENGINE).graph.nodes.find(([id]) => id === ids.title)?.[1].text).toBe(
      'my own words'
    )
    expect(overlay.isLocked(ids.title)).toBe(false)
  })

  test("an unnamed brand:user-image layer previews the output's chosen asset before the gallery default", () => {
    const { store, overlay, ids, before } = build({ lock: true, preferredUserImage: 'alt' })
    const hero = asset('hero', 'user-image', true, 'Hero')
    const alt = asset('alt', 'user-image', false, 'Alt')
    overlay.setBrandAssets([
      { asset: hero, bytes: PNG },
      { asset: alt, bytes: PNG_2 }
    ])
    expect(overlay.brandAssetFor(ids.brand)?.id).toBe('alt')
    expect(node(store, ids.brand).fills?.[0]).toMatchObject({ imageHash: computeImageHash(PNG_2) })
    // A person's explicit choice still wins.
    overlay.setBrandChoice(ids.brand, 'hero')
    expect(overlay.brandAssetFor(ids.brand)?.id).toBe('hero')
    expect(saved(overlay)).toBe(before)
  })
})

describe('brand text preview (Track FB-69, H-68)', () => {
  test('brand:display-name / brand:handle show the kit’s text from the payload; nothing is an edit, the save is byte-equal', () => {
    const { store, overlay, ids, before } = build({ brandText: BRAND_TEXT })
    // Painted on sync — no content selection needed (the kit is not a preview choice).
    expect(node(store, ids.displayName).text).toBe('Nizek')
    expect(node(store, ids.displayName).styleRuns).toEqual([
      { start: 0, length: 5, style: { fontWeight: 600 } }
    ])
    // Case-insensitive name, like every binding.
    expect(node(store, ids.handle).text).toBe('@nizek')
    expect(overlay.isPreviewed(ids.displayName)).toBe(true)
    expect(overlay.isPreviewed(ids.handle)).toBe(true)
    // Box and font stay.
    expect(node(store, ids.displayName).width).toBe(600)
    expect(node(store, ids.displayName).fontSize).toBe(32)
    // The content layers are untouched without a content selection.
    expect(node(store, ids.title).text).toBe('Title placeholder')

    expect(store.hasUnsavedChanges()).toBe(false)
    expect(store.undo.canUndo).toBe(false)
    expect(saved(overlay)).toBe(before)
    expect(saved(overlay)).toContain('"Your name"')
    expect(saved(overlay)).toContain('"@yourhandle"')
    expect(saved(overlay)).not.toContain('Nizek')
  })

  test('an empty kit value paints an empty layer — never the placeholder, never a refusal', () => {
    const { store, overlay, ids, before } = build({
      brandText: { 'display-name': 'Nizek', handle: '' }
    })
    expect(node(store, ids.handle).text).toBe('')
    expect(overlay.isPreviewed(ids.handle)).toBe(true)
    expect(node(store, ids.displayName).text).toBe('Nizek')
    expect(saved(overlay)).toBe(before)
    // The runs of the emptied layer collapse; the document keeps its own.
    expect(node(store, ids.displayName).styleRuns).toEqual([
      { start: 0, length: 5, style: { fontWeight: 600 } }
    ])
    expect(store.hasUnsavedChanges()).toBe(false)
  })

  test('no brand.text (an older app) leaves the layers untouched; a slot the app did not send too', () => {
    const older = build()
    expect(node(older.store, older.ids.displayName).text).toBe('Your name')
    expect(node(older.store, older.ids.handle).text).toBe('@yourhandle')
    expect(older.overlay.isPreviewed(older.ids.displayName)).toBe(false)
    expect(saved(older.overlay)).toBe(older.before)
    older.overlay.dispose()
    older.store.dispose()

    const partial = build({ brandText: { 'display-name': 'Nizek' } })
    expect(node(partial.store, partial.ids.displayName).text).toBe('Nizek')
    expect(node(partial.store, partial.ids.handle).text).toBe('@yourhandle')
    expect(partial.overlay.isPreviewed(partial.ids.handle)).toBe(false)
    expect(saved(partial.overlay)).toBe(partial.before)

    const none = build({ brandText: null })
    expect(node(none.store, none.ids.displayName).text).toBe('Your name')
    expect(saved(none.overlay)).toBe(none.before)
  })

  test('a selected brand text layer keeps the preview; an edit is adopted', () => {
    const { store, overlay, ids } = build({ brandText: BRAND_TEXT })
    store.select([ids.displayName])
    expect(node(store, ids.displayName).text).toBe('Nizek')
    expect(overlay.isPreviewed(ids.displayName)).toBe(true)
    store.select([])
    expect(node(store, ids.displayName).text).toBe('Nizek')

    store.select([ids.displayName])
    store.updateNodeWithUndo(ids.displayName, { text: 'Name goes here' }, 'Edit text')
    store.select([])
    expect(node(store, ids.displayName).text).toBe('Nizek')
    const doc = overlay.serialize(ENGINE)
    expect(doc.graph.nodes.find(([id]) => id === ids.displayName)?.[1].text).toBe('Name goes here')
    expect(JSON.stringify(doc)).not.toContain('Nizek')
    expect(store.hasUnsavedChanges()).toBe(true)
  })

  test('serialize restores the originals; dispose lifts them; a rename out of the vocabulary drops the paint', () => {
    const { store, overlay, ids, before } = build({ brandText: BRAND_TEXT })
    overlay.setContent({ kind: 'sample' })
    const doc = overlay.serialize(ENGINE)
    const plain = doc.graph.nodes.find(([id]) => id === ids.displayName)?.[1]
    expect(plain?.text).toBe('Your name')
    expect(plain?.styleRuns).toEqual([{ start: 0, length: 9, style: { fontWeight: 600 } }])
    expect(JSON.stringify(doc)).toBe(before)

    // `brand:handle:x` is not a binding (the app's rule) — the layer shows its own text again.
    store.updateNodeWithUndo(ids.handle, { name: 'brand:handle:x' }, 'Rename')
    expect(node(store, ids.handle).text).toBe('@yourhandle')
    expect(overlay.isPreviewed(ids.handle)).toBe(false)
    store.updateNodeWithUndo(ids.handle, { name: 'brand:handle' }, 'Rename')
    expect(node(store, ids.handle).text).toBe('@nizek')
    // The renames are the only edits the document carries.
    const renamed = overlay.serialize(ENGINE)
    expect(renamed.graph.nodes.find(([id]) => id === ids.handle)?.[1].text).toBe('@yourhandle')
    expect(JSON.stringify(renamed)).not.toContain('@nizek')

    overlay.dispose()
    expect(node(store, ids.displayName).text).toBe('Your name')
    expect(node(store, ids.handle).text).toBe('@yourhandle')
    expect(JSON.stringify(serializeGraph(store.graph, ENGINE))).toBe(JSON.stringify(renamed))
  })

  test('design mode: the two layers are locked like content text, with their own kind reported', () => {
    const { store, overlay, ids, before, refused, refusedKinds } = build({
      lock: true,
      brandText: BRAND_TEXT
    })
    expect(overlay.isLocked(ids.displayName)).toBe(true)
    expect(overlay.lockedKind(ids.displayName)).toBe('brand-text')
    expect(overlay.lockedKind(ids.title)).toBe('content')
    expect(overlay.lockedKind(ids.brand)).toBeNull()

    // Selection does not lift the kit's text.
    store.select([ids.handle])
    expect(node(store, ids.handle).text).toBe('@nizek')

    // A write that lands anyway is put back and reported as the brand kit's.
    store.updateNode(ids.handle, { text: '@mine' })
    expect(refused).toEqual([ids.handle])
    expect(refusedKinds).toEqual(['brand-text'])
    expect(node(store, ids.handle).text).toBe('@nizek')
    expect(saved(overlay)).toBe(before)

    // Boxes stay editable.
    store.updateNode(ids.handle, { width: 300 })
    expect(node(store, ids.handle).width).toBe(300)
    expect(refused).toEqual([ids.handle])
  })

  test('without the lock the layers are not locked even with the kit’s text painted', () => {
    const { overlay, ids } = build({ brandText: BRAND_TEXT })
    expect(overlay.isLocked(ids.displayName)).toBe(false)
    expect(overlay.lockedKind(ids.displayName)).toBeNull()
  })
})
