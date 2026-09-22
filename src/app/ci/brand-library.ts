// CI: the workspace brand kit as a components library (ADR-058 §8, Part B).
//
// Colours and font names travel INSIDE the document as the `Brand` variables
// collection (the app applies `applyBrandVariables` before it hands the
// document over). What the document cannot carry is the kit's media — the
// logo in its light and dark variants and the workspace's photos — so the
// Studio publishes them as image COMPONENTs into a per-workspace library
// (`ci-brand:<slug>`) and enables it on the open document. The Assets panel
// then offers "Logo (light)", "Logo (dark)" and every photo as drag-in
// instances, exactly like a published OpenPencil library.

import type { SceneGraph as SceneGraphType, SceneNode } from '@open-pencil/scene-graph'
import { SceneGraph } from '@open-pencil/scene-graph'
import { BLACK } from '@open-pencil/scene-graph/constants'
import { computeImageHash } from '@open-pencil/scene-graph/images'

import type { ViewportSize } from '@/app/document/io/types'
import type { EditorStore } from '@/app/editor/session'
import { useLibraryService } from '@/app/libraries/service'

import type { StudioAPI, StudioBrand, StudioBrandAsset } from './api'

export const BRAND_LIBRARY_PREFIX = 'ci-brand:'

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
    // Logos are displayed at a sensible working size; photos keep their pixels.
    const scale = asset.kind === 'photo' ? 1 : Math.min(1, 480 / Math.max(size.width, size.height))
    const width = Math.max(1, Math.round(size.width * scale))
    const height = Math.max(1, Math.round(size.height * scale))
    const component = graph.createNode('COMPONENT', page.id, {
      name: asset.name,
      x: cursorX,
      y: 0,
      width,
      height,
      fills: [],
      clipsContent: true,
      pluginData: [
        { pluginId: 'content-intelligence', key: 'brandAsset', value: asset.key },
        {
          pluginId: 'content-intelligence',
          key: 'role',
          value: asset.kind === 'photo' ? 'accent' : 'logo'
        }
      ]
    })
    graph.createNode('RECTANGLE', component.id, {
      name: asset.kind === 'photo' ? 'Photo' : 'Logo',
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
          imageScaleMode: asset.kind === 'photo' ? 'FILL' : 'FIT'
        }
      ]
    })
    componentIds.push(component.id)
    cursorX += width + 64
  }
  return { graph, componentIds }
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
  } = {}
): Promise<BrandLibraryReport> {
  const libraryId = brandLibraryId(workspaceSlug)
  const report: BrandLibraryReport = { libraryId, published: [], failed: [], installed: false }
  if (brand.assets.length === 0) return report

  const loaded: Array<{ asset: StudioBrandAsset; bytes: Uint8Array; size: ImageDimensions }> = []
  await Promise.all(
    brand.assets.map(async (asset) => {
      try {
        const bytes = await api.fetchBytes(asset.url, options.signal)
        const size = await measureImage(bytes, options.decode)
        loaded.push({ asset, bytes, size })
      } catch (error) {
        report.failed.push({
          key: asset.key,
          message: error instanceof Error ? error.message : String(error)
        })
      }
    })
  )
  // Deterministic order regardless of which fetch finished first.
  loaded.sort((a, b) => brand.assets.indexOf(a.asset) - brand.assets.indexOf(b.asset))
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
    description: 'Logo and photos from the workspace brand kit. Managed by Content Intelligence.',
    graph,
    assetNodeIds: componentIds,
    previousRevisionId
  })
  await libraries.enable(store, libraryId, revision.manifest.revisionId)
  report.published = loaded.map(({ asset }) => asset.key)
  report.installed = true
  return report
}

/** Names the panel shows for the fixed asset kinds; photos keep the app's name. */
export function brandAssetDisplayName(asset: Pick<StudioBrandAsset, 'kind' | 'name'>): string {
  if (asset.kind === 'logo-light') return 'Logo (light)'
  if (asset.kind === 'logo-dark') return 'Logo (dark)'
  return asset.name
}

export type { SceneNode }
