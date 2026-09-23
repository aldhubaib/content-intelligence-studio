// CI: Preview with real content — the overlay (Track E3d-b1, FB-44 §6).
//
// ONE store for everything the person previews with: the content selection
// (a candidate · the sample text · none) and a brand asset per `brand:*` layer.
// The overlay paints those values onto the bound layers through the engine's
// PREVIEW channel (`graph.updateNodePreview`) — the same path a drag uses
// before it commits — so nothing it does is an edit: no `node:updated`, no
// history entry, no dirty flag. The document's own values are kept in
// `originals` and `serialize()` puts them back into the saved JSON, byte for
// byte, so a template never carries a candidate's words or an image the
// designer only previewed with.
//
// Rules the overlay keeps:
//   • a selected TEXT layer shows its OWN text (the inspector, in-place editing
//     and history all read the live node) — the preview returns on deselect;
//   • an edit that lands on an overlaid key is either the overlay echoing back
//     (ignored) or a real document change (adopted as the new original, with
//     a preview image hash never accepted into the document);
//   • a layer renamed away from `content:*` / `brand:*` drops its preview; one
//     renamed into a binding picks the current selection up;
//   • a recreated / duplicated layer that carries preview values (undo of a
//     delete, ⌘D on an overlaid layer) is corrected back to the document values.
//
// Track E3d-c (design mode, `lockContentText`): the post's text is FIXED on
// the `content:*` text layers — a selected layer keeps showing it, in-place
// editing is refused (`onLockedEdit` says why) and a text write that lands
// anyway is put back to the document's placeholder. A `preferredBrandAsset`
// (the person's user-image choice for the output) is what an unnamed
// `brand:user-image` layer previews with.

import { isEqual, pick } from 'es-toolkit'
import { shallowRef, type Ref } from 'vue'

import { copyFills, type Fill, type SceneNode } from '@open-pencil/scene-graph'
import { BLACK } from '@open-pencil/scene-graph/constants'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import type { EditorStore } from '@/app/editor/session'

import type {
  StudioBindingsVocabulary,
  StudioBrandAsset,
  StudioBrandAssetKind,
  StudioPreviewContent,
  StudioRoleName
} from './api'
import { bindingOf, listBindings, roleOfFrameName, type Binding, type BindingRef } from './bindings'
import { resolveBrandAsset } from './brand-library'
import { serializeGraph, type SerializedDocument } from './document'
import { contentOf, contentPreviewChanges, type ContentPreviewSelection } from './preview'

export interface LoadedBrandAsset {
  asset: StudioBrandAsset
  bytes: Uint8Array
}

export interface PreviewOverlayOptions {
  vocabulary: () => StudioBindingsVocabulary
  sampleText: () => StudioPreviewContent | null
  /** Bytes of a candidate image URL (bearer, app origin); absent → images are never previewed. */
  loadImage?: (url: string) => Promise<Uint8Array>
  log?: (message: string, error: unknown) => void
  /** Track E3d-c: the text on `content:*` text layers comes from the post and cannot be edited here. */
  lockContentText?: () => boolean
  /** Told (node id) when a locked layer's text edit was refused / put back. */
  onLockedEdit?: (nodeId: string) => void
  /** Track E3d-c: the asset an unnamed `brand:<kind>` layer previews with before the gallery default (the output's user-image choice). */
  preferredBrandAsset?: (kind: StudioBrandAssetKind) => string | null
}

export interface PreviewOverlay {
  /** The content selection — the title-row menu reads and writes it. */
  readonly content: Ref<ContentPreviewSelection>
  /** Per-layer brand choices (layer id → asset id); a layer without one shows its binding's default. */
  readonly brandChoices: Ref<ReadonlyMap<string, string>>
  /** Bumps after every sync — panels re-read on it. */
  readonly tick: Ref<number>
  setContent(selection: ContentPreviewSelection): void
  /** Pick an asset for one `brand:*` layer; null = back to the binding's default. */
  setBrandChoice(layerId: string, assetId: string | null): void
  /** The brand assets and their bytes once the library loaded them. */
  setBrandAssets(loaded: readonly LoadedBrandAsset[]): void
  readonly brandAssets: Ref<readonly StudioBrandAsset[]>
  /** The asset a `brand:*` layer previews with right now (choice, else default). */
  brandAssetFor(layerId: string): StudioBrandAsset | null
  /** True while the layer shows a preview value. */
  isPreviewed(nodeId: string): boolean
  /** Track E3d-c: true for a `content:*` text layer while content text is locked (design mode). */
  isLocked(nodeId: string): boolean
  /** Re-read the graph and paint / lift as needed. */
  sync(): void
  /** The document WITHOUT the overlay — what every save sends. */
  serialize(engineVersion: string): SerializedDocument
  dispose(): void
}

/** The keys a preview may touch; nothing else on a node is ever overlaid. */
const OVERLAY_KEYS = ['text', 'styleRuns', 'fills'] as const satisfies readonly (keyof SceneNode)[]
type OverlayKey = (typeof OVERLAY_KEYS)[number]

/** Structural equality after JSON normalisation — a clone may carry `undefined` keys the original lacks. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === undefined || b === undefined) return false
  return isEqual(jsonNormalised(a), jsonNormalised(b))
}

/** The value as JSON sees it: `undefined` members dropped (a clone, but that is not the point). */
function jsonNormalised(value: unknown): unknown {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- structuredClone keeps `undefined` members; JSON drops them.
  return JSON.parse(JSON.stringify(value)) as unknown
}

/** The image hashes a node's paint lists reference. */
function imageHashesOf(
  node: Partial<Pick<SceneNode, 'fills' | 'textDecorationFills'>>,
  into: Set<string>
): void {
  const lists: Array<readonly Fill[] | undefined> = [node.fills, node.textDecorationFills]
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const paint of list) if (paint.imageHash) into.add(paint.imageHash)
  }
}

function imageFill(hash: string, scaleMode: Fill['imageScaleMode'], from: Fill | undefined): Fill {
  return {
    type: 'IMAGE',
    color: BLACK,
    opacity: from?.opacity ?? 1,
    visible: true,
    imageHash: hash,
    imageScaleMode: from?.imageScaleMode ?? scaleMode
  }
}

function firstImageFill(fills: readonly Fill[] | undefined): Fill | undefined {
  return fills?.find((f) => f.type === 'IMAGE')
}

export function createPreviewOverlay(
  store: EditorStore,
  options: PreviewOverlayOptions
): PreviewOverlay {
  const content = shallowRef<ContentPreviewSelection>({ kind: 'none' })
  const brandChoices = shallowRef<ReadonlyMap<string, string>>(new Map())
  const brandAssets = shallowRef<readonly StudioBrandAsset[]>([])
  const tick = shallowRef(0)
  const log = options.log ?? ((message, error) => console.warn(`[CI Studio] ${message}`, error))

  /** Bytes by asset id (brand) and by URL (candidate images). */
  const brandBytes = new Map<string, Uint8Array>()
  const imageBytes = new Map<string, Uint8Array>()
  const imageLoads = new Map<string, Promise<void>>()
  /** Document values under the overlay, per node, for the keys the overlay touched. */
  const originals = new Map<string, Partial<SceneNode>>()
  /** The overlay values currently on each node. */
  const applied = new Map<string, Partial<SceneNode>>()
  /** Track E3d-c: `source.editedFields` of a locked layer before any refused write, per node. */
  const editedFieldsBefore = new Map<string, readonly string[]>()
  /** Image hashes the overlay put into `graph.images`. */
  const previewHashes = new Set<string>()
  const disposers: Array<() => void> = []
  let disposed = false
  let syncing = false

  const graph = () => store.graph

  function captureOriginal(node: SceneNode, keys: readonly OverlayKey[]): void {
    const previous = originals.get(node.id) ?? {}
    const missing = keys.filter((key) => !Object.hasOwn(previous, key))
    if (missing.length) Object.assign(previous, structuredClone(pick(node, missing)))
    originals.set(node.id, previous)
    if (!editedFieldsBefore.has(node.id))
      editedFieldsBefore.set(node.id, [...node.source.editedFields])
  }

  function ensureImage(bytes: Uint8Array): string {
    const hash = computeImageHash(bytes)
    if (!graph().images.has(hash)) {
      graph().images.set(hash, bytes)
      previewHashes.add(hash)
    }
    return hash
  }

  function roleOf(ref: BindingRef): StudioRoleName | null {
    if (!ref.frameId) return null
    const frame = graph().getNode(ref.frameId)
    return frame ? roleOfFrameName(frame.name) : null
  }

  function candidateImageBytes(url: string): Uint8Array | null {
    const cached = imageBytes.get(url)
    if (cached) return cached
    const loadImage = options.loadImage
    if (!loadImage || imageLoads.has(url)) return null
    const load = (async () => {
      try {
        const bytes = await loadImage(url)
        imageBytes.set(url, bytes)
        if (!disposed) sync()
      } catch (error: unknown) {
        log('preview image failed', error)
      } finally {
        imageLoads.delete(url)
      }
    })()
    imageLoads.set(url, load)
    return null
  }

  /** `fills` with every preview image swapped for the document's image, or dropped when the document had none. */
  function withoutPreviewImages(
    fills: readonly Fill[],
    documentFills: readonly Fill[] | undefined
  ): Fill[] {
    const documentImage = firstImageFill(documentFills)
    const cleaned: Fill[] = []
    for (const fill of fills) {
      if (!fill.imageHash || !previewHashes.has(fill.imageHash)) {
        cleaned.push(fill)
      } else if (documentImage) {
        cleaned.push({
          ...fill,
          imageHash: documentImage.imageHash,
          imageScaleMode: documentImage.imageScaleMode
        })
      }
    }
    if (cleaned.length === 0 && documentFills) return copyFills([...documentFills])
    return cleaned
  }

  const locked = () => options.lockContentText?.() ?? false

  function textSuppressed(nodeId: string): boolean {
    // Design mode: the post's text stays on the layer while it is selected — it IS what the design shows.
    if (locked()) return false
    return store.state.selectedIds.has(nodeId) || store.state.editingTextId === nodeId
  }

  /**
   * An auto-height text layer inside an auto-layout frame is measured by the
   * layout pass from its LIVE text and its box is written back to the document —
   * a preview there would size the document from words it never held. Such a
   * layer keeps its placeholder (the box rule: a preview never moves a box).
   */
  function autoSizedInLayout(node: SceneNode): boolean {
    if (node.textAutoResize !== 'HEIGHT' && node.textAutoResize !== 'WIDTH_AND_HEIGHT') return false
    let parent = node.parentId ? graph().getNode(node.parentId) : undefined
    while (parent) {
      if (parent.layoutMode !== 'NONE') return true
      parent = parent.parentId ? graph().getNode(parent.parentId) : undefined
    }
    return false
  }

  /** What the overlay wants on this bound layer right now; null = nothing (lift). */
  function desiredFor(ref: BindingRef, node: SceneNode): Partial<SceneNode> | null {
    if (ref.binding.kind === 'content') {
      const shown = contentOf(content.value, options.sampleText())
      if (!shown) return null
      if (node.type === 'TEXT') {
        if (textSuppressed(node.id) || autoSizedInLayout(node)) return null
        return contentPreviewChanges(node, ref.binding.slot, shown, {
          role: roleOf(ref),
          maxChars: ref.maxChars
        })
      }
      if (ref.binding.slot !== 'image') return null
      if (content.value.kind !== 'candidate') return null
      const url = content.value.candidate.imageUrl
      if (!url) return null
      const bytes = candidateImageBytes(url)
      if (!bytes) return null
      return { fills: [imageFill(ensureImage(bytes), 'FILL', firstImageFill(node.fills))] }
    }
    if (node.type === 'TEXT') return null
    const asset = brandAssetFor(node.id, ref.binding)
    const bytes = asset ? brandBytes.get(asset.id) : undefined
    if (!asset || !bytes) return null
    const scale = asset.kind === 'user-image' ? 'FILL' : 'FIT'
    return { fills: [imageFill(ensureImage(bytes), scale, firstImageFill(node.fills))] }
  }

  function brandAssetFor(layerId: string, binding?: Binding): StudioBrandAsset | null {
    const chosen = brandChoices.value.get(layerId)
    if (chosen) {
      const asset = brandAssets.value.find((a) => a.id === chosen)
      if (asset) return asset
    }
    const b = binding ?? bindingOfNode(layerId)
    if (b?.kind !== 'brand') return null
    // Track E3d-c: an unnamed layer previews with the output's own choice before the gallery default.
    if (!b.name && options.preferredBrandAsset) {
      const preferred = options.preferredBrandAsset(b.slotKind as StudioBrandAssetKind)
      const asset = preferred
        ? brandAssets.value.find((a) => a.id === preferred && a.kind === b.slotKind)
        : undefined
      if (asset) return asset
    }
    return resolveBrandAsset(brandAssets.value, b)
  }

  function bindingOfNode(nodeId: string): Binding | null {
    const node = graph().getNode(nodeId)
    return node ? bindingOf(node, options.vocabulary()) : null
  }

  /** A `content:<text slot>` TEXT layer — the layers design mode locks. */
  function isLockedTextLayer(nodeId: string): boolean {
    const node = graph().getNode(nodeId)
    if (node?.type !== 'TEXT') return false
    const b = bindingOf(node, options.vocabulary())
    return b?.kind === 'content' && b.slot !== 'image'
  }

  function apply(node: SceneNode, desired: Partial<SceneNode>): void {
    const keys = Object.keys(desired) as OverlayKey[]
    captureOriginal(node, keys)
    const current = applied.get(node.id)
    // Keys the previous overlay touched but this one does not go back to the document value.
    const restore: Partial<SceneNode> = {}
    if (current) {
      for (const key of Object.keys(current) as OverlayKey[]) {
        if (!(key in desired))
          Reflect.set(restore, key, structuredClone(originals.get(node.id)?.[key]))
      }
    }
    if (current && sameValue(current, desired) && Object.keys(restore).length === 0) return
    graph().updateNodePreview(node.id, { ...restore, ...structuredClone(desired) })
    applied.set(node.id, desired)
  }

  /**
   * Put the document values back and forget them — a lifted layer's live
   * values ARE the document again, so the next apply captures fresh originals
   * (an edit made while lifted must not be shadowed by a stale copy). The
   * originals of a DELETED node are kept for the undo that recreates it.
   */
  function lift(nodeId: string): void {
    const current = applied.get(nodeId)
    if (!current) return
    applied.delete(nodeId)
    const node = graph().getNode(nodeId)
    const original = originals.get(nodeId)
    if (!node || !original) return
    const back = structuredClone(pick(original, Object.keys(current) as OverlayKey[]))
    graph().updateNodePreview(nodeId, back)
    originals.delete(nodeId)
  }

  /** Drop preview images no live node references any more. */
  function pruneImages(): void {
    if (previewHashes.size === 0) return
    const referenced = new Set<string>()
    for (const node of graph().getAllNodes()) imageHashesOf(node, referenced)
    const stale = [...previewHashes].filter((hash) => !referenced.has(hash))
    for (const hash of stale) {
      graph().images.delete(hash)
      previewHashes.delete(hash)
    }
  }

  /**
   * Write document values onto a node WITHOUT recording an edit: the node was
   * born (undo, duplicate) carrying preview words, and the correction restores
   * what the document held — the preview channel puts the value in place with
   * no `node:updated`, no history entry and no `editedFields` mark.
   */
  function correct(node: SceneNode, values: Partial<SceneNode>): void {
    const changed: Partial<SceneNode> = {}
    for (const key of Object.keys(values) as OverlayKey[]) {
      if (!sameValue(node[key], values[key]))
        Reflect.set(changed, key, structuredClone(values[key]))
    }
    if (Object.keys(changed).length > 0) graph().updateNodePreview(node.id, changed)
  }

  function sync(): void {
    if (disposed || syncing) return
    syncing = true
    try {
      const seen = new Set<string>()
      for (const ref of listBindings(graph(), options.vocabulary(), store.state.currentPageId)) {
        const node = graph().getNode(ref.nodeId)
        if (!node) continue
        seen.add(ref.nodeId)
        const desired = desiredFor(ref, node)
        if (desired) apply(node, desired)
        else lift(ref.nodeId)
      }
      for (const nodeId of Array.from(applied.keys())) if (!seen.has(nodeId)) lift(nodeId)
      pruneImages()
      store.requestRender()
      tick.value++
    } finally {
      syncing = false
    }
  }

  /**
   * Design mode (Track E3d-c): a text write on a locked layer is refused — the
   * document keeps its placeholder, the layer keeps showing the post's text.
   */
  function refuseLockedWrite(
    id: string,
    changes: Partial<SceneNode>,
    current: Partial<SceneNode>
  ): void {
    const original = originals.get(id) ?? {}
    const putBack: Partial<SceneNode> = {}
    for (const key of ['text', 'styleRuns'] as const) {
      if (!Object.hasOwn(changes, key) || !Object.hasOwn(original, key)) continue
      if (sameValue(changes[key], current[key]) || sameValue(changes[key], original[key])) continue
      Reflect.set(putBack, key, structuredClone(original[key]))
    }
    if (Object.keys(putBack).length > 0) {
      // Through the preview channel: no second `node:updated`, no history entry,
      // and the edit mark the refused write left on `source.editedFields` is undone.
      const node = graph().getNode(id)
      const before = editedFieldsBefore.get(id)
      if (node && before) {
        const refusedKeys = Object.keys(putBack)
        putBack.source = {
          ...node.source,
          editedFields: node.source.editedFields.filter(
            (key) => before.includes(key) || !refusedKeys.includes(key)
          )
        }
      }
      applied.delete(id)
      graph().updateNodePreview(id, putBack)
      options.onLockedEdit?.(id)
    }
    sync()
  }

  /** A document write on an overlaid key: the overlay's own echo, or a real change to adopt. */
  function onNodeUpdated(id: string, changes: Partial<SceneNode>): void {
    const current = applied.get(id)
    if (current && locked() && isLockedTextLayer(id)) {
      refuseLockedWrite(id, changes, current)
      return
    }
    if (current) {
      const original = originals.get(id) ?? {}
      let corrected: Partial<SceneNode> = {}
      let adopted = false
      for (const key of Object.keys(changes) as (keyof SceneNode)[]) {
        if (!Object.hasOwn(current, key)) continue
        const value = changes[key]
        if (sameValue(value, current[key])) continue
        adopted = true
        // A real edit: the document moved under the overlay. A preview image hash
        // never becomes a document value — put the original image (or fills) back.
        if (key === 'fills' && Array.isArray(value)) {
          const fills = value as Fill[]
          if (fills.some((f) => f.imageHash && previewHashes.has(f.imageHash))) {
            const next = withoutPreviewImages(fills, original.fills)
            original.fills = copyFills(next)
            corrected = { ...corrected, fills: next }
            continue
          }
        }
        Reflect.set(original, key, structuredClone(value))
      }
      if (adopted) {
        // The document moved under the overlay: the live node now holds the new
        // document value, the next sync captures it and paints again.
        originals.set(id, original)
        applied.delete(id)
        if (Object.keys(corrected).length > 0) graph().updateNode(id, corrected)
      }
      // Anything else (a rename, a resize, plugin data) re-reads the binding.
      sync()
      return
    }
    const keys = Object.keys(changes)
    if (
      keys.some((key) =>
        [
          'name',
          'pluginData',
          'text',
          'fills',
          'styleRuns',
          'width',
          'height',
          'fontSize',
          'lineHeight',
          'visible'
        ].includes(key)
      )
    )
      sync()
  }

  /** A layer born with preview values (undo of a delete, a duplicate) is corrected to document values. */
  function onNodeCreated(node: SceneNode): void {
    const binding = bindingOf(node, options.vocabulary())
    if (binding) {
      const remembered = originals.get(node.id)
      if (remembered) {
        correct(node, remembered)
        originals.delete(node.id)
      } else {
        const name = node.name
        const twin = [...applied.entries()].find(([twinId, values]) => {
          if (twinId === node.id) return false
          const other = graph().getNode(twinId)
          return (
            other?.name === name &&
            sameValue(pick(node, Object.keys(values) as OverlayKey[]), values)
          )
        })
        if (twin) {
          const twinOriginal = originals.get(twin[0])
          if (twinOriginal) correct(node, pick(twinOriginal, Object.keys(twin[1]) as OverlayKey[]))
        }
      }
    }
    sync()
  }

  function reset(): void {
    editedFieldsBefore.clear()
    originals.clear()
    applied.clear()
    previewHashes.clear()
    imageLoads.clear()
  }

  function serialize(engineVersion: string): SerializedDocument {
    const doc = serializeGraph(graph(), engineVersion)
    const referenced = new Set<string>()
    for (const [id, plain] of doc.graph.nodes) {
      const current = applied.get(id)
      const original = originals.get(id)
      if (current && original) {
        // Every overlay key exists on a node, so every original was captured.
        for (const key of Object.keys(current) as OverlayKey[]) {
          if (Object.hasOwn(original, key)) Reflect.set(plain, key, structuredClone(original[key]))
        }
      }
      imageHashesOf(plain, referenced)
    }
    doc.graph.images = doc.graph.images.filter(
      ([hash]) => !previewHashes.has(hash) || referenced.has(hash)
    )
    return doc
  }

  disposers.push(store.onEditorEvent('node:updated', onNodeUpdated))
  disposers.push(store.onEditorEvent('node:created', onNodeCreated))
  disposers.push(
    store.onEditorEvent('node:deleted', (id) => {
      applied.delete(id)
      sync()
    })
  )
  disposers.push(store.onEditorEvent('node:reparented', () => sync()))
  disposers.push(store.onEditorEvent('selection:changed', () => sync()))
  disposers.push(store.onEditorEvent('page:changed', () => sync()))
  disposers.push(
    store.onEditorEvent('graph:replaced', () => {
      reset()
      sync()
    })
  )

  return {
    content,
    brandChoices,
    brandAssets,
    tick,
    setContent(selection) {
      content.value = selection
      sync()
    },
    setBrandChoice(layerId, assetId) {
      const next = new Map(brandChoices.value)
      if (assetId) next.set(layerId, assetId)
      else next.delete(layerId)
      brandChoices.value = next
      sync()
    },
    setBrandAssets(loaded) {
      brandBytes.clear()
      for (const { asset, bytes } of loaded) brandBytes.set(asset.id, bytes)
      brandAssets.value = loaded.map((l) => l.asset)
      sync()
    },
    brandAssetFor: (layerId) => brandAssetFor(layerId),
    isPreviewed: (nodeId) => applied.has(nodeId),
    isLocked: (nodeId) => locked() && isLockedTextLayer(nodeId),
    sync,
    serialize,
    dispose() {
      if (disposed) return
      disposed = true
      for (const stop of disposers) stop()
      for (const id of Array.from(applied.keys())) lift(id)
      pruneImages()
      reset()
    }
  }
}
