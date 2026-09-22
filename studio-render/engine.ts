// CI: the render sidecar's engine — one CanvasKit per process, the pinned
// @open-pencil/core headless path, brand fonts from bytes only (ADR-058 §8, Track E3c Part E).
//
// This is the server twin of the app's E3b headless adapter
// (`src/design/engine/openpencil/headless.ts` in content-intelligence): same
// SkiaRenderer over a 1×1 CPU surface, same `loadFonts()` / `prepareForExport()`
// sequence, same direct raster at `scale`, same readiness probe. The sidecar
// never fetches a font — the app sends every face it wants shaped as bytes,
// keyed by sha256, and this module registers them with core's font manager.

import type { CanvasKit } from 'canvaskit-wasm'

import { SkiaRenderer } from '@open-pencil/core/canvas'
import { computeContentBounds, renderNodesToImage } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { fontManager, prepareGraphFonts, weightToStyle } from '@open-pencil/core/text'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { deserializeGraph } from '../src/app/ci/document'

export const ENGINE_VERSION = '0.15.1'

export type FontReadiness = 'ready' | 'pending' | 'substituted' | 'exhausted'

export interface RenderFont {
  family: string
  weight: 400 | 700
  data: ArrayBuffer
}

export interface RenderInput {
  document: unknown
  frameId?: string
  scale: number
  mode?: 'direct' | 'supersample'
  fonts: readonly RenderFont[]
}

export interface RenderReport {
  png: Uint8Array
  width: number
  height: number
  frameId: string
  mode: 'direct' | 'supersample'
  engineVersion: string
  fontIssues: string[]
  textReadiness: Record<string, FontReadiness>
  timings: {
    canvasKitMs: number
    parseMs: number
    fontsMs: number
    renderMs: number
    rasterMs?: number
    encodeMs?: number
  }
}

export class RenderInputError extends Error {
  readonly code: 'unsupported_document' | 'frame_not_found' | 'no_frame'
  constructor(code: RenderInputError['code'], message: string) {
    super(message)
    this.name = 'RenderInputError'
    this.code = code
  }
}

// ---------------------------------------------------------------------------
// CanvasKit — one instance per process, initialised lazily
// ---------------------------------------------------------------------------

let canvasKit: Promise<{ ck: CanvasKit; renderer: SkiaRenderer }> | null = null
let engineReady = false

/** `canvaskit-wasm/full`'s glue + `.wasm` directory, decoded so a path with spaces still resolves. */
function canvasKitBinDir(): string {
  const url = import.meta.resolve('canvaskit-wasm/full')
  return decodeURIComponent(new URL('.', url).pathname)
}

async function headlessRenderer(): Promise<{ ck: CanvasKit; renderer: SkiaRenderer }> {
  canvasKit ??= (async () => {
    fontManager.setOnlineFontProviders({
      google: false,
      fontsource: false,
      bunny: false,
      fontshare: false
    })
    const CanvasKitInit = (await import('canvaskit-wasm/full')).default
    const binDir = canvasKitBinDir()
    const ck = await CanvasKitInit({ locateFile: (file: string) => binDir + file })
    const surface = ck.MakeSurface(1, 1)
    if (!surface) throw new Error('[studio-render] CanvasKit could not create a CPU surface')
    const renderer = new SkiaRenderer(ck, surface)
    renderer.viewportWidth = 1
    renderer.viewportHeight = 1
    renderer.dpr = 1
    await renderer.loadFonts()
    // Same fallback chain as the hosted editor (src/app/ci/fonts.ts): the bundled Noto Naskh Arabic
    // shapes Arabic glyphs inside a Latin-only brand face.
    if (await fontManager.loadFont('Noto Naskh Arabic', 'Regular')) {
      fontManager.setArabicFallbackFamily('Noto Naskh Arabic')
    }
    engineReady = true
    return { ck, renderer }
  })()
  canvasKit.catch(() => {
    // A failed boot is not sticky: the next render retries the initialisation.
    canvasKit = null
  })
  return canvasKit
}

/** Warm the engine (health / boot); errors surface to the caller. */
export function warmEngine(): Promise<void> {
  return headlessRenderer().then(() => undefined)
}

export function engineState(): 'cold' | 'warming' | 'ready' {
  if (!canvasKit) return 'cold'
  return engineReady ? 'ready' : 'warming'
}

// ---------------------------------------------------------------------------
// Fonts — bytes in, one typeface per (family, style)
// ---------------------------------------------------------------------------

/**
 * Registers each face once per process. `@fontsource` ships per-script
 * subsets; registering a second buffer under the same key makes Skia pick
 * whichever landed first — so the FIRST buffer wins and later ones are
 * dropped (the app sends ONE merged multi-script file per brand face).
 */
export function registerFonts(fonts: readonly RenderFont[]): {
  registered: string[]
  dropped: string[]
} {
  const seen = new Set<string>()
  const registered: string[] = []
  const dropped: string[] = []
  for (const font of fonts) {
    const style = weightToStyle(font.weight)
    const key = `${font.family}|${style}`
    if (seen.has(key) || fontManager.isStyleLoaded(font.family, style)) {
      dropped.push(key)
      continue
    }
    seen.add(key)
    fontManager.markLoaded(font.family, style, font.data, 'registered')
    registered.push(key)
  }
  return { registered, dropped }
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function documentPage(graph: SceneGraph): SceneNode {
  const page = graph.getPages()[0]
  if (!page) throw new RenderInputError('no_frame', 'The document has no page.')
  return page
}

function rootFrames(graph: SceneGraph): SceneNode[] {
  const page = documentPage(graph)
  const frames: SceneNode[] = []
  for (const id of page.childIds) {
    const node = graph.getNode(id)
    if (node?.type === 'FRAME') frames.push(node)
  }
  return frames
}

/** Direct raster: one CPU surface at the target size, Skia AA only, PNG via CanvasKit's encoder. */
function renderFrameDirect(
  ck: CanvasKit,
  renderer: SkiaRenderer,
  graph: SceneGraph,
  pageId: string,
  frameId: string,
  scale: number
): { png: Uint8Array; rasterMs: number; encodeMs: number } {
  const bounds = computeContentBounds(graph, [frameId])
  if (!bounds) throw new Error('[studio-render] frame has no bounds')
  const width = Math.ceil((bounds.maxX - bounds.minX) * scale)
  const height = Math.ceil((bounds.maxY - bounds.minY) * scale)
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('[studio-render] CanvasKit could not create the export surface')
  const t0 = performance.now()
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.scale(scale, scale)
    canvas.translate(-bounds.minX, -bounds.minY)
    renderer.renderSceneToCanvas(canvas, graph, pageId)
    surface.flush()
    const t1 = performance.now()
    const image = surface.makeImageSnapshot()
    const encoded = image.encodeToBytes(ck.ImageFormat.PNG, 100)
    image.delete()
    const t2 = performance.now()
    if (!encoded) throw new Error('[studio-render] PNG encode failed')
    return { png: new Uint8Array(encoded), rasterMs: t1 - t0, encodeMs: t2 - t1 }
  } finally {
    surface.delete()
  }
}

/**
 * The renderer SKIPS a text node whose font demand is still `pending` and
 * fires the demand on the first readiness probe, so a one-shot export probes
 * every text node and waits for the resolver to settle. Bounded poll.
 */
async function awaitTextReadiness(
  renderer: SkiaRenderer,
  graph: SceneGraph,
  rootId: string,
  deadlineMs = 3000
): Promise<Record<string, FontReadiness>> {
  const textNodes = graph
    .flattenTree(rootId)
    .map(({ node }) => node)
    .filter((node) => node.type === 'TEXT' && node.text)
  const started = performance.now()
  for (;;) {
    const readiness: Record<string, FontReadiness> = {}
    let pending = false
    for (const node of textNodes) {
      const state = renderer.nodeFontReadiness(node) as FontReadiness
      readiness[node.name] = state
      if (state === 'pending') pending = true
    }
    if (!pending || performance.now() - started > deadlineMs) return readiness
    await Bun.sleep(20)
  }
}

let renderQueue: Promise<unknown> = Promise.resolve()

/** Serialise renders in this process (the renderer's picture cache and text measurer are shared). */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = renderQueue.then(work, work)
  renderQueue = next.catch(() => undefined)
  return next
}

export function renderDocument(input: RenderInput): Promise<RenderReport> {
  return enqueue(() => renderNow(input))
}

async function renderNow(input: RenderInput): Promise<RenderReport> {
  const t0 = performance.now()
  const { ck, renderer } = await headlessRenderer()
  const t1 = performance.now()

  let graph: SceneGraph
  try {
    graph = deserializeGraph(input.document)
  } catch (error) {
    throw new RenderInputError(
      'unsupported_document',
      error instanceof Error
        ? error.message
        : 'The document is not an openpencil-scene-graph envelope.'
    )
  }
  computeAllLayouts(graph)
  const t2 = performance.now()

  registerFonts(input.fonts)
  const page = documentPage(graph)
  const frames = rootFrames(graph)
  const frame = input.frameId ? frames.find((f) => f.id === input.frameId) : frames[0]
  if (!frame) {
    throw new RenderInputError(
      input.frameId ? 'frame_not_found' : 'no_frame',
      input.frameId ? `Frame not found: ${input.frameId}` : 'The document has no frame to render.'
    )
  }
  const status = await prepareGraphFonts(graph, [frame.id])
  const t3 = performance.now()

  renderer.invalidateAllPictures()
  const textReadiness = await awaitTextReadiness(renderer, graph, frame.id)
  const restoreTextMeasurer = await renderer.prepareForExport(graph, page.id, [frame.id])
  const mode = input.mode ?? 'direct'
  let png: Uint8Array | null
  let rasterMs: number | undefined
  let encodeMs: number | undefined
  try {
    if (mode === 'direct') {
      const direct = renderFrameDirect(ck, renderer, graph, page.id, frame.id, input.scale)
      png = direct.png
      rasterMs = direct.rasterMs
      encodeMs = direct.encodeMs
    } else {
      png = renderNodesToImage(ck, renderer, graph, page.id, [frame.id], {
        scale: input.scale,
        format: 'PNG',
        trimTransparent: false
      })
    }
  } finally {
    restoreTextMeasurer()
  }
  const t4 = performance.now()
  if (!png) throw new Error('[studio-render] nothing rendered')

  return {
    png,
    width: Math.ceil(frame.width * input.scale),
    height: Math.ceil(frame.height * input.scale),
    frameId: frame.id,
    mode,
    engineVersion: ENGINE_VERSION,
    fontIssues: status.issues.map((face) => `${face.family} ${face.style} (${face.status})`),
    textReadiness,
    timings: {
      canvasKitMs: t1 - t0,
      parseMs: t2 - t1,
      fontsMs: t3 - t2,
      renderMs: t4 - t3,
      rasterMs,
      encodeMs
    }
  }
}
