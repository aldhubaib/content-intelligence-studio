// CI: the workspace brand kit as a components library (ADR-058 §8, Part B;
// Track E3d-a FB-44 §4 / §5 — named galleries).
//
// Colours travel INSIDE the document as the `Brand` variables collection (the
// app applies `applyBrandVariables` before it hands the document over). What
// the document cannot carry is the kit's media — the user images and the
// company logo in its light and dark variants — so the Studio publishes them
// as image COMPONENTs into a per-workspace library (`ci-brand:<slug>`) and
// enables it on the open document. Every component is NAMED BY ITS BINDING
// (`brand:user-image:Hero`, `brand:company-logo-light:Mark`) so an instance
// dragged in from the Assets panel is a bound layer the moment it lands.
//
// A `brand:<kind>[:<name>]` layer already in the document opens with its asset
// painted in (`previewBrandBindings`): the named one, else the gallery's
// default — the same resolution the renderer applies (FB-44 §5).

import type { SceneGraph as SceneGraphType, SceneNode } from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'
import { BLACK } from '@open-pencil/scene-graph/constants'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import type { ViewportSize } from '@/app/document/io/types'
import type { EditorStore } from '@/app/editor/session'
import { useLibraryService } from '@/app/libraries/service'

import type { StudioAPI, StudioBindingsVocabulary, StudioBrand, StudioBrandAsset } from './api'
import { bindingName, listBindings, PLUGIN_ID } from './bindings'

export const BRAND_LIBRARY_PREFIX = 'ci-brand:'
/** Plugin key on a previewed layer: the image hash the Studio painted in for the person. */
export const PLUGIN_BRAND_PREVIEW_KEY = 'brandPreview'

export function brandLibraryId(workspaceSlug: string): string {
  const safe = workspaceSlug.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 100) || 'workspace'
  return `${BRAND_LIBRARY_PREFIX}${safe}`
}

export interface BrandLibraryReport {
  libraryId: string
  published: string[]
  failed: Array<{ key: string; message: string }>
  /** False when the kit has no media — nothing to publish, nothing enabled. */
  installed: boolean
}

/** Pixel size of a decoded brand asset — the same shape as the document viewport size. */
export type ImageDimensions = ViewportSize

/** Decode enough of a PNG / JPEG / WebP / SVG header to size the component; 512² when unknown. */
export async function measureImage(
  bytes: Uint8Array,
  decode: (bytes: Uint8Array) => Promise<ImageDimensions | null> = decodeInBrowser
): Promise<ImageDimensions> {
  const decoded = await decode(bytes)
  if (decoded && decoded.width > 0 && decoded.height > 0) return decoded
  return { width: 512, height: 512 }
}

async function decodeInBrowser(bytes: Uint8Array): Promise<ImageDimensions | null> {
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]))
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

/** `brand:user-image:Hero` — the layer name an instance of this asset carries. */
export function brandAssetBindingName(asset: Pick<StudioBrandAsset, 'kind' | 'name'>): string {
  return bindingName({ kind: 'brand', slotKind: asset.kind, name: asset.name })
}

const BRAND_KIND_WORDS: Record<StudioBrandAsset['kind'], string> = {
  'user-image': 'user image',
  'company-logo-light': 'light logo',
  'company-logo-dark': 'dark logo'
}

/** "Hero · user image (default)" — what the Assets panel says under the component. */
export function brandAssetDescription(
  asset: Pick<StudioBrandAsset, 'kind' | 'name' | 'isDefault'>
): string {
  const kind = BRAND_KIND_WORDS[asset.kind]
  return `${asset.name} · ${kind}${asset.isDefault ? ' (default)' : ''}`
}

/**
 * Build the library source graph: one COMPONENT per asset, each holding a
 * rectangle with an IMAGE fill over the asset bytes. Pure over the bytes so a
 * unit test can run it without a network.
 */
export function buildBrandLibraryGraph(
  assets: ReadonlyArray<{ asset: StudioBrandAsset; bytes: Uint8Array; size: ImageDimensions }>
): { graph: SceneGraphType; componentIds: string[] } {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  page.name = 'Brand'
  const componentIds: string[] = []
  let cursorX = 0
  for (const { asset, bytes, size } of assets) {
    const hash = computeImageHash(bytes)
    if (!graph.images.has(hash)) graph.images.set(hash, bytes)
    // Logos are displayed at a sensible working size; user images keep their pixels.
    const isLogo = asset.kind !== 'user-image'
    const scale = isLogo ? Math.min(1, 480 / Math.max(size.width, size.height)) : 1
    const width = Math.max(1, Math.round(size.width * scale))
    const height = Math.max(1, Math.round(size.height * scale))
    const component = graph.createNode('COMPONENT', page.id, {
      name: brandAssetBindingName(asset),
      x: cursorX,
      y: 0,
      width,
      height,
      fills: [],
      clipsContent: true,
      pluginData: [
        { pluginId: PLUGIN_ID, key: 'brandAsset', value: asset.id },
        { pluginId: PLUGIN_ID, key: 'brandAssetKind', value: asset.kind },
        { pluginId: PLUGIN_ID, key: 'role', value: isLogo ? 'logo' : 'accent' }
      ]
    })
    graph.createNode('RECTANGLE', component.id, {
      name: asset.name,
      x: 0,
      y: 0,
      width,
      height,
      fills: [
        {
          type: 'IMAGE',
          color: BLACK,
          opacity: 1,
          visible: true,
          imageHash: hash,
          imageScaleMode: isLogo ? 'FIT' : 'FILL'
        }
      ]
    })
    componentIds.push(component.id)
    cursorX += width + 64
  }
  return { graph, componentIds }
}

type LoadedAsset = { asset: StudioBrandAsset; bytes: Uint8Array; size: ImageDimensions }

async function loadAssets(
  api: StudioAPI,
  assets: readonly StudioBrandAsset[],
  report: Pick<BrandLibraryReport, 'failed'>,
  options: {
    signal?: AbortSignal
    decode?: (bytes: Uint8Array) => Promise<ImageDimensions | null>
  }
): Promise<LoadedAsset[]> {
  const loaded: LoadedAsset[] = []
  await Promise.all(
    assets.map(async (asset) => {
      try {
        const bytes = await api.fetchBytes(asset.url, options.signal)
        const size = await measureImage(bytes, options.decode)
        loaded.push({ asset, bytes, size })
      } catch (error) {
        report.failed.push({
          key: asset.id,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  )
  // Deterministic order regardless of which fetch finished first.
  loaded.sort((a, b) => assets.indexOf(a.asset) - assets.indexOf(b.asset))
  return loaded
}

/**
 * Fetch every asset, publish the library revision and enable it on the store's
 * document. Idempotent per session: publishing the same bytes yields the same
 * revision id, and enabling an already-enabled library is a no-op.
 */
export async function installBrandLibrary(
  store: EditorStore,
  api: StudioAPI,
  brand: StudioBrand,
  workspaceSlug: string,
  options: {
    signal?: AbortSignal
    decode?: (bytes: Uint8Array) => Promise<ImageDimensions | null>
    /** Receives the fetched bytes so the caller can paint previews without a second round trip. */
    onLoaded?: (assets: LoadedAsset[]) => void
  } = {}
): Promise<BrandLibraryReport> {
  const libraryId = brandLibraryId(workspaceSlug)
  const report: BrandLibraryReport = { libraryId, published: [], failed: [], installed: false }
  if (brand.assets.length === 0) return report

  const loaded = await loadAssets(api, brand.assets, report, options)
  options.onLoaded?.(loaded)
  if (loaded.length === 0) return report

  const { graph, componentIds } = buildBrandLibraryGraph(loaded)
  const libraries = useLibraryService()
  let previousRevisionId: string | null = null
  try {
    const existing = (await libraries.listLibraries()).find((s) => s.libraryId === libraryId)
    previousRevisionId = existing?.latestRevisionId ?? null
  } catch {
    previousRevisionId = null
  }
  const revision = await libraries.publish({
    libraryId,
    name: `Brand — ${brand.workspaceName}`,
    description:
      'User images and company logos from the workspace brand kit. Managed by Content Intelligence.',
    graph,
    assetNodeIds: componentIds,
    previousRevisionId
  })
  await libraries.enable(store, libraryId, revision.manifest.revisionId)
  report.published = loaded.map(({ asset }) => asset.id)
  report.installed = true
  return report
}

/**
 * The asset a `brand:<kind>[:<name>]` binding resolves to: the named asset of
 * that kind, else the kind's default, else null (the renderer refuses with
 * "No <kind> yet" — the panel shows the same).
 */
export function resolveBrandAsset(
  assets: readonly StudioBrandAsset[],
  binding: { slotKind: string; name: string | null }
): StudioBrandAsset | null {
  const ofKind = assets.filter((a) => a.kind === binding.slotKind)
  if (binding.name) {
    const wanted = binding.name.toLowerCase()
    return ofKind.find((a) => a.name.toLowerCase() === wanted) ?? null
  }
  return ofKind.find((a) => a.isDefault) ?? ofKind.at(0) ?? null
}

export interface BrandPreviewReport {
  painted: string[]
  /** Bindings with no asset behind them — "No dark logo yet" territory. */
  unresolved: string[]
}

/**
 * Paint every brand-bound shape layer with its asset so the template opens the
 * way it renders. Goes through the store (undoable, dirty) — the caller decides
 * whether the document stays "saved" afterwards. Text layers and layers already
 * showing the same image are left alone.
 */
export function previewBrandBindings(
  store: EditorStore,
  loaded: readonly LoadedAsset[],
  vocabulary: StudioBindingsVocabulary
): BrandPreviewReport {
  const report: BrandPreviewReport = { painted: [], unresolved: [] }
  const assets = loaded.map((l) => l.asset)
  for (const ref of listBindings(store.graph, vocabulary, store.state.currentPageId)) {
    if (ref.binding.kind !== 'brand' || ref.nodeType === 'TEXT') continue
    const asset = resolveBrandAsset(assets, ref.binding)
    const entry = asset ? loaded.find((l) => l.asset.id === asset.id) : undefined
    if (!asset || !entry) {
      report.unresolved.push(ref.name)
      continue
    }
    const node = store.graph.getNode(ref.nodeId)
    if (!node) continue
    const hash = computeImageHash(entry.bytes)
    const already = node.fills.some((f) => f.type === 'IMAGE' && f.imageHash === hash)
    if (already) continue
    if (!store.graph.images.has(hash)) store.graph.images.set(hash, entry.bytes)
    const pluginData = [
      ...(Array.isArray(node.pluginData) ? node.pluginData : []).filter(
        (e) => !(e.pluginId === PLUGIN_ID && e.key === PLUGIN_BRAND_PREVIEW_KEY)
      ),
      { pluginId: PLUGIN_ID, key: PLUGIN_BRAND_PREVIEW_KEY, value: hash }
    ]
    store.updateNode(ref.nodeId, {
      fills: [
        {
          type: 'IMAGE',
          color: BLACK,
          opacity: 1,
          visible: true,
          imageHash: hash,
          imageScaleMode: asset.kind === 'user-image' ? 'FILL' : 'FIT'
        }
      ],
      pluginData
    })
    report.painted.push(ref.name)
  }
  return report
}

export type { SceneNode }
