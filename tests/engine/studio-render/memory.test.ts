// CI: the sidecar renders for the life of the process — its memory must plateau (INC-13).
//
// Production rendered 70 designs in 80 s and then answered "CanvasKit could not
// create the export surface" for every render until the container was
// replaced: every design carried its own image, and the shared renderer kept
// each decoded image (plus per-node geometry) in caches only `destroy()` empties.
// This test renders 100 documents that each carry a DIFFERENT 1080 × 700 image
// at the production scale (2×) and asserts the CanvasKit heap and the process
// RSS stop growing once the engine is warm.
import { describe, expect, test } from 'bun:test'

import { engineStats, renderDocument } from '#studio-render/engine'

const FIXTURE = new URL('../../fixtures/ci/hosted-template.json', import.meta.url)
const RENDERS = 100
const WARM_RENDERS = 10
const IMAGE_WIDTH = 1080
const IMAGE_HEIGHT = 700
const MB = 1024 * 1024
// One decoded 1080 × 700 RGBA image with mipmaps is ≈ 4 MB; a leak of one image
// per render would add ≈ 360 MB across the measured window. Allow far less.
const HEAP_GROWTH_CAP_MB = 48
const RSS_GROWTH_CAP_MB = 192

interface FixtureNode {
  name?: string
  fills?: unknown[]
}

interface FixtureDocument {
  graph: { nodes: Array<[string, FixtureNode]>; images: Array<[string, string]> }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** A solid-colour RGBA PNG whose bytes differ per `seed` (so its hash does too). */
function solidPNG(width: number, height: number, seed: number): Uint8Array {
  const raw = new Uint8Array((width * 4 + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1)
    raw[row] = 0 // filter: none
    for (let x = 0; x < width; x += 1) {
      const px = row + 1 + x * 4
      raw[px] = (seed * 37 + x) & 0xff
      raw[px + 1] = (seed * 91 + y) & 0xff
      raw[px + 2] = seed & 0xff
      raw[px + 3] = 0xff
    }
  }
  const ihdr = new Uint8Array(13)
  const view = new DataView(ihdr.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  const idat = new Uint8Array(Bun.deflateSync(raw))
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0))
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** The fixture with its `content:image` rectangle filled by a fresh image and a fresh title. */
function documentWithImage(base: FixtureDocument, seed: number): FixtureDocument {
  const png = solidPNG(IMAGE_WIDTH, IMAGE_HEIGHT, seed)
  const hash = `img-${seed.toString(16).padStart(8, '0')}`
  const nodes = base.graph.nodes.map(([id, node]): [string, FixtureNode] => {
    if (node.name === 'content:image') {
      return [
        id,
        {
          ...node,
          fills: [
            {
              type: 'IMAGE',
              color: { r: 0, g: 0, b: 0, a: 1 },
              opacity: 1,
              visible: true,
              imageHash: hash,
              imageScaleMode: 'FILL'
            }
          ]
        }
      ]
    }
    if (node.name === 'content:title') {
      return [id, { ...node, text: `Design ${seed} — عنوان رقم ${seed}` } as FixtureNode]
    }
    return [id, node]
  })
  return {
    ...base,
    graph: { ...base.graph, nodes, images: [[hash, Buffer.from(png).toString('base64')]] }
  }
}

interface Sample {
  render: number
  /** CanvasKit WASM heap (`HEAPU8.length`) — the resource that ran out in production. */
  heapMb: number
  /** Process RSS after a full GC: what the container sees. */
  rssMb: number
  /** JS heap after a full GC: retained JS objects (includes the WASM buffer). */
  jsMb: number
}

/** Retained memory: a full GC first, so the test's own PNG / base64 garbage is not counted. */
function measure(render: number): Sample {
  Bun.gc(true)
  const heapBytes = engineStats().heapBytes
  if (heapBytes === null) throw new Error('engine is cold')
  const usage = process.memoryUsage()
  return {
    render,
    heapMb: Math.round((heapBytes / MB) * 10) / 10,
    rssMb: Math.round((usage.rss / MB) * 10) / 10,
    jsMb: Math.round((usage.heapUsed / MB) * 10) / 10
  }
}

describe('render memory', () => {
  test(
    `${RENDERS} renders with distinct images plateau in CanvasKit heap and RSS`,
    async () => {
      const base = (await Bun.file(FIXTURE).json()) as FixtureDocument
      const samples: Sample[] = []
      for (let i = 1; i <= RENDERS; i += 1) {
        const report = await renderDocument({
          document: documentWithImage(base, i),
          scale: 2,
          fonts: []
        })
        expect(report.width).toBe(2160)
        expect(report.png.byteLength).toBeGreaterThan(1000)
        if (i % 10 === 0) {
          const sample = measure(i)
          samples.push(sample)
          // oxlint-disable-next-line no-console -- progressive numbers survive a WASM abort
          console.log(JSON.stringify(sample))
        }
      }
      const warm = samples.find((s) => s.render === WARM_RENDERS)
      const final = samples.at(-1)
      if (!warm || !final) throw new Error('samples missing')
      expect(engineStats().renders).toBeGreaterThanOrEqual(RENDERS)
      expect(final.heapMb - warm.heapMb).toBeLessThan(HEAP_GROWTH_CAP_MB)
      expect(final.rssMb - warm.rssMb).toBeLessThan(RSS_GROWTH_CAP_MB)
    },
    600_000
  )
})
