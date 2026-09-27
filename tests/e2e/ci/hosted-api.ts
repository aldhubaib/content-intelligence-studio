// CI: the stubbed app API every hosted e2e boots against (Track E3c Part B;
// Track E3d-a FB-44 / FB-45; Track E3d-b1 FB-44 §6). Playwright's route
// interception answers `GET|PUT /api/studio/templates/<id>`, the preview
// candidates route and the app's templates page.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deflateSync } from 'node:zlib'

import { type Page, type Route } from '@playwright/test'

export const API = 'https://app.ci.test'
export const TEMPLATE_ID = 'tpl-hosted-smoke'
/** Track E3d-c: the design whose OWN copy the design spec opens, and the row its first save births. */
export const DESIGN_ID = 'des-hosted-smoke'
export const DESIGN_ID_NEXT = 'des-hosted-smoke-2'
/** The `cover` frame inside `tests/fixtures/ci/hosted-template.json`. */
export const FRAME_ID = '0:3'

export type SavedBody = {
  kind: string
  baseVersion?: number
  name?: string
  document?: unknown
}

// Written by `serializeGraph` (src/app/ci/document.ts): one 1080×1350 `cover` frame
// with a `content:image` rectangle and an Arabic `content:title` text layer. The
// `-legacy` copy carries the E3b names (`Portrait`, `slot:cover`, `slot:headline`).
function templateDocument(fixture = 'hosted-template'): unknown {
  return JSON.parse(
    readFileSync(resolve(import.meta.dirname, `../../fixtures/ci/${fixture}.json`), 'utf8')
  )
}

export const FORMAT = {
  id: 'instagram_post',
  label: 'Instagram post',
  platform: 'INSTAGRAM',
  width: 1080,
  height: 1350,
  aspect: '4:5',
  safeInsetPct: [4, 4, 12, 4],
  slideCap: 1
}
export const CAROUSEL = {
  ...FORMAT,
  id: 'instagram_carousel',
  label: 'Instagram carousel',
  slideCap: 10
}

export const VOCABULARY = {
  contentText: ['title', 'subtitle', 'body', 'cta', 'article-url'],
  contentImage: ['image'],
  reserved: ['ai-image'],
  brandKinds: ['user-image', 'company-logo-light', 'company-logo-dark'],
  roles: ['cover', 'repeat', 'ending'],
  legacy: {
    headline: 'title',
    body: 'body',
    quote: 'body',
    attribution: 'subtitle',
    article_url: 'article-url',
    cover: 'image'
  },
  // Track FB-65: what the system writes into each name — the app's `bindingDescriptions()`.
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

export type AIBlock = {
  enabled: boolean
  models?: Array<{ id: string; label: string }>
}

// Track E3d-b1 (FB-44 §6): the app's `payload.preview` block and one Approved
// Arabic candidate the **Preview with ▾** menu can pick. `candidates: null`
// makes the candidates route answer 404 — an older app — and the menu must say
// "Preview unavailable" instead of failing.
export const CANDIDATES_PATH = `/api/studio/templates/${TEMPLATE_ID}/preview-candidates`
export const SAMPLE_TEXT = {
  title: 'عنوان تجريبي للمعاينة',
  subtitle: 'سطر فرعي',
  body: 'نص تجريبي يوضح شكل القالب مع محتوى حقيقي.',
  cta: 'اقرأ المزيد',
  articleUrl: 'https://example.com/article'
}
export const CANDIDATE = {
  id: 'cand-1',
  title: 'كيف تبني عادة القراءة اليومية',
  subtitle: 'خطوات صغيرة، أثر كبير',
  body: 'ابدأ بعشر دقائق يومياً، واختر كتاباً تحبه، ثم زد الوقت تدريجياً.',
  cta: 'شاركنا تجربتك',
  articleUrl: 'https://example.com/reading-habit',
  format: 'INSTAGRAM_CAPTION',
  formatLabel: 'Instagram caption',
  approvedAt: '2026-09-22T09:00:00Z',
  imageUrl: null
}

// FB-58: one brand asset the Assets panel's Brand library shows — a real PNG the
// Studio can decode, served bearer-gated from the asset path like the app does.
export const BRAND_ASSET_PATH = `/api/studio/templates/${TEMPLATE_ID}/assets/asset-hero`
export const BRAND_ASSET = {
  id: 'asset-hero',
  name: 'Hero',
  url: `${API}${BRAND_ASSET_PATH}`,
  kind: 'user-image',
  isDefault: true,
  contentType: 'image/png'
}
export const BRAND_ASSET_SIZE = { width: 64, height: 48 }
export const BRAND = {
  workspaceName: 'Nizek',
  colors: { primary: '#0f62fe', secondary: '#393939' },
  assets: [BRAND_ASSET]
}

/** A solid-colour RGBA PNG built in-process (no fixture binary, no image library). */
export function solidPNG(width: number, height: number, rgb: [number, number, number]): Buffer {
  const crcTable = new Uint32Array(256).map((_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc32 = (bytes: Buffer) => {
    let c = 0xffffffff
    for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(typed))
    return Buffer.concat([length, typed, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const row = Buffer.alloc(1 + width * 4)
  for (let x = 0; x < width; x++) row.set([...rgb, 255], 1 + x * 4)
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

export interface APIOptions {
  ai?: AIBlock
  fixture?: string
  format?: typeof FORMAT
  /** Candidates the preview route answers; `null` → the route 404s (older app). */
  candidates?: Array<typeof CANDIDATE> | null
  /** FB-58: the payload's `brand` block; default none (the library is not installed). */
  brand?: typeof BRAND | null
}

export async function installAPI(page: Page, saves: SavedBody[], options: APIOptions = {}) {
  const ai = options.ai ?? { enabled: false }
  let version = 3
  let name = 'Smoke portrait'
  await page.route(`${API}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === BRAND_ASSET_PATH && request.method() === 'GET') {
      if (request.headers()['authorization'] !== 'Bearer smoke-token') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      return route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: solidPNG(BRAND_ASSET_SIZE.width, BRAND_ASSET_SIZE.height, [218, 30, 40])
      })
    }
    if (url.pathname === CANDIDATES_PATH && request.method() === 'GET') {
      if (request.headers()['authorization'] !== 'Bearer smoke-token') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      if (options.candidates === null) {
        return route.fulfill({ status: 404, json: { error: 'not found' } })
      }
      return route.fulfill({
        json: { candidates: options.candidates ?? [CANDIDATE] }
      })
    }
    if (url.pathname === `/api/studio/templates/${TEMPLATE_ID}`) {
      if (request.headers()['authorization'] !== 'Bearer smoke-token') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      if (request.method() === 'GET') {
        return route.fulfill({
          json: {
            document: templateDocument(options.fixture),
            name,
            version,
            updatedAt: '2026-09-22T10:00:00Z',
            format: options.format ?? FORMAT,
            formats: [FORMAT, CAROUSEL],
            collection: null,
            brand: options.brand ?? null,
            fonts: [],
            bindings: {
              vocabulary: VOCABULARY,
              report: {
                version: 'bindings-v3',
                usable: { single: true, carousel: false },
                statusWords: 'Usable'
              }
            },
            ai,
            preview: {
              candidatesUrl: `${API}${CANDIDATES_PATH}`,
              sampleText: SAMPLE_TEXT
            }
          }
        })
      }
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as SavedBody
        saves.push(body)
        if (body.kind === 'rename') {
          name = body.name ?? name
          return route.fulfill({ json: { name } })
        }
        if (body.kind === 'duplicate') {
          return route.fulfill({
            json: { templateId: 'tpl-copy', name: body.name ?? 'copy' }
          })
        }
        version += 1
        return route.fulfill({
          json: { version, updatedAt: '2026-09-22T10:01:00Z' }
        })
      }
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
}

/**
 * Unframed (as after File → Open in new tab) the Studio has no host to ask, so a
 * navigation is a real `location.assign` to the app; the app's templates page is
 * answered by the same route interception with a marker document.
 */
export const TEMPLATES_URL = `${API}/w/nizek/templates`
export async function installAppPages(page: Page): Promise<void> {
  await page.route(`${TEMPLATES_URL}**`, (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<title>Templates · app</title><h1 data-app-page="templates">Templates</h1>'
    })
  )
}

// Track E3d-c: the post's content behind `GET /api/studio/designs/<id>` — the
// template document above with the design's facts; a PUT `version` answers a
// NEW design id the session must move to.
export const DESIGN_CONTENT = {
  title: 'أسعار الإيجار في الكويت ترتفع',
  subtitle: 'LinkedIn insight',
  body: 'ارتفعت أسعار الإيجار هذا العام. إليك ما يعنيه ذلك للمستأجرين.',
  cta: 'اقرأ المزيد',
  articleUrl: null,
  bodyChunks: ['ارتفعت أسعار الإيجار هذا العام.', 'إليك ما يعنيه ذلك للمستأجرين.'],
  imageUrl: null,
  draftId: 'draft-1',
  candidateId: 'cand-1'
}
export const DESIGN_NAME = 'Rent prices · LinkedIn Post · v2'
export const DESIGN_BACK = '/w/nizek/plan?item=req-1'

export interface DesignAPIOptions {
  fixture?: string
  ownCopy?: boolean
}

export async function installDesignAPI(
  page: Page,
  saves: SavedBody[],
  options: DesignAPIOptions = {}
) {
  let currentId = DESIGN_ID
  let version = 2
  let ownCopy = options.ownCopy ?? false
  await page.route(`${API}/**`, async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const match = /^\/api\/studio\/designs\/([^/]+)$/.exec(url.pathname)
    if (match) {
      if (request.headers()['authorization'] !== 'Bearer smoke-token') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      if (match[1] !== currentId) {
        return route.fulfill({ status: 404, json: { error: 'not found' } })
      }
      if (request.method() === 'GET') {
        return route.fulfill({
          json: {
            kind: 'design',
            designId: currentId,
            document: templateDocument(options.fixture),
            name: DESIGN_NAME.replace(/v\d+$/, `v${version}`),
            version,
            updatedAt: '2026-09-22T10:00:00Z',
            format: {
              ...FORMAT,
              id: 'linkedin_post',
              label: 'LinkedIn post',
              platform: 'LINKEDIN'
            },
            formats: [FORMAT, CAROUSEL],
            template: { id: TEMPLATE_ID, key: 'kuwaiti_card', label: 'Kuwaiti card', version: 3 },
            content: DESIGN_CONTENT,
            userImageAssetId: null,
            ownCopy,
            renderStatus: 'rendered',
            back: { href: DESIGN_BACK },
            brand: null,
            fonts: [],
            bindings: {
              vocabulary: VOCABULARY,
              report: {
                version: 'bindings-v3',
                usable: { single: true, carousel: false },
                statusWords: 'Usable'
              }
            },
            ai: { enabled: false },
            draft: null
          }
        })
      }
      if (request.method() === 'PUT') {
        const body = request.postDataJSON() as SavedBody
        saves.push(body)
        if (body.kind !== 'version') {
          return route.fulfill({ status: 400, json: { error: 'no_draft_slot' } })
        }
        if (body.baseVersion !== version) {
          return route.fulfill({
            status: 409,
            json: { error: 'conflict', currentVersion: version, currentDesignId: currentId }
          })
        }
        version += 1
        currentId = DESIGN_ID_NEXT
        ownCopy = true
        return route.fulfill({
          json: {
            kind: 'version',
            designId: currentId,
            version,
            renderStatus: 'pending',
            updatedAt: '2026-09-22T10:01:00Z'
          }
        })
      }
    }
    return route.fulfill({ status: 404, json: { error: 'not found' } })
  })
}
