// CI: the stubbed app API every hosted e2e boots against (Track E3c Part B;
// Track E3d-a FB-44 / FB-45; Track E3d-b1 FB-44 §6; Track FB-61 `contract`). Playwright's route
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
  // Track fb74-studio-preview-kinds (H-70): `number` / `step` — the app's `CONTENT_TEXT_SLOTS` since FB-74.
  contentText: ['title', 'subtitle', 'body', 'cta', 'article-url', 'number', 'step'],
  contentImage: ['image'],
  reserved: ['ai-image'],
  brandKinds: ['user-image', 'company-logo-light', 'company-logo-dark'],
  // Track FB-69: the brand kit's TEXT names — `src/server/studio/payload.ts` on the app.
  brandText: ['display-name', 'handle'],
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
    'content:number': "the Number kind's figure (text; empty for other kinds)",
    'content:step':
      'one step / item of a List or Steps kind on a repeat frame (text; empty otherwise)',
    'content:image': "the source post's image (image fill)",
    'content:ai-image': 'reserved, placeholder today',
    'brand:user-image': 'your default user image',
    'brand:company-logo-light': 'light logo, for dark backgrounds',
    'brand:company-logo-dark': 'dark logo, for light backgrounds',
    'brand:<kind>:<asset name>': 'a named asset instead of the default',
    'brand:display-name': "the brand kit's display name (text; empty when the kit has none)",
    'brand:handle': "the brand kit's handle as @handle (text; empty when the kit has none)",
    cover: 'required, the first / only image',
    repeat: 'one per body chunk on carousel formats',
    ending: 'optional last slide with the CTA'
  }
}

/** Track FB-69: an app before H-68 — no brand text names, no descriptions for them. */
export const VOCABULARY_OLDER = (() => {
  const { brandText: _brandText, descriptions, ...rest } = VOCABULARY
  const { 'brand:display-name': _dn, 'brand:handle': _h, ...olderDescriptions } = descriptions
  return { ...rest, descriptions: olderDescriptions }
})()

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

// Track fb74-studio-preview-kinds (H-70): the second section — one How-to kind of
// a READY piece, id `kind:<piece>:<key>`, the steps in `slots.step` and the
// figure a Number kind would carry in `slots.number`.
export const KIND_CANDIDATE = {
  id: 'kind:piece-1:how_to',
  title: 'كيف تقلل الاجتماعات',
  subtitle: 'إنتاجية',
  body: 'احذف اجتماعًا واحدًا أسبوعيًا.\nاكتب جدولًا قبل كل اجتماع.\nأنهِ الاجتماع عند انتهاء الجدول.',
  cta: 'ابدأ بالخطوة الأولى اليوم.',
  articleUrl: 'https://example.invalid/articles/preview',
  bodyChunks: [
    'احذف اجتماعًا واحدًا أسبوعيًا.',
    'اكتب جدولًا قبل كل اجتماع.',
    'أنهِ الاجتماع عند انتهاء الجدول.'
  ],
  slots: {
    number: '٣',
    step: [
      'احذف اجتماعًا واحدًا أسبوعيًا.',
      'اكتب جدولًا قبل كل اجتماع.',
      'أنهِ الاجتماع عند انتهاء الجدول.'
    ]
  },
  format: null,
  formatLabel: null,
  approvedAt: '2026-09-22T10:00:00Z',
  imageUrl: null,
  kind: { key: 'how_to', nameEn: 'How-to', nameAr: 'خطوات', pieceTitle: 'أسبوع بلا اجتماعات' }
}
export type PreviewCandidateFixture = typeof CANDIDATE | typeof KIND_CANDIDATE
export const GROUP_LABELS = { arabic: 'Approved Arabic candidates', kinds: 'Article kinds' }

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
/** Track FB-69: the kit's text as the app sends it — the handle carries its `@`. */
export const BRAND_TEXT = { 'display-name': 'Nizek', handle: '@nizek' }
export const BRAND = {
  workspaceName: 'Nizek',
  colors: { primary: '#0f62fe', secondary: '#393939' },
  assets: [BRAND_ASSET],
  text: BRAND_TEXT
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
  /** Candidates the preview route answers (the Arabic section); `null` → the route 404s (older app). */
  candidates?: Array<PreviewCandidateFixture> | null
  /**
   * Track fb74-studio-preview-kinds (H-70): the Article kinds section. Default one How-to
   * kind; `[]` → an empty section; `null` → the route answers the flat list ONLY (an app
   * before this track) and the menu shows the one Arabic section.
   */
  kinds?: Array<PreviewCandidateFixture> | null
  /** FB-58: the payload's `brand` block; default none (the library is not installed). Track FB-69: `text` may be absent. */
  brand?: (Omit<typeof BRAND, 'text'> & { text?: typeof BRAND_TEXT }) | null
  /** Track FB-69: the vocabulary the payload carries; `VOCABULARY_OLDER` plays an app before H-68. */
  vocabulary?: typeof VOCABULARY | typeof VOCABULARY_OLDER
  /**
   * Track FB-61: the payload's `contract` block. Default → derived from `format.slideCap` the
   * way the app does; `null` → absent (an older app), the Studio derives its own.
   */
  contract?: ContractBlock | null
}

/** The app's `StudioContractPayload` as the stub answers it (rows computed over the SAVED version). */
export type ContractBlock = {
  roles: Array<'cover' | 'repeat' | 'ending'>
  slideCap: number
  carousel: boolean
  helper: string
  rows: Array<{
    role: 'cover' | 'repeat' | 'ending'
    label: string
    requirement: 'required' | 'optional' | null
    needs: string
    present: boolean
    met: boolean
    words: string
  }>
  unusedRoles: Array<'cover' | 'repeat' | 'ending'>
}

const CONTRACT_LABELS = {
  cover: {
    label: 'Cover (required) — needs content:title or content:body',
    requirement: 'required' as const,
    needs: 'content:title or content:body'
  },
  repeat: {
    label: 'Repeat — needs content:body',
    requirement: null,
    needs: 'content:body'
  },
  ending: {
    label: 'Ending (optional) — takes content:cta',
    requirement: 'optional' as const,
    needs: 'content:cta'
  }
}

const SMOKE_ROW_WORDS = {
  cover: 'met',
  repeat: 'not met — add a repeat frame with content:body',
  ending: 'not added — optional'
}

/** The contract block the app would send for `format` over the smoke fixture (cover present and met, nothing else). */
export function contractFor(format: { slideCap: number }): ContractBlock {
  const carousel = format.slideCap > 1
  const roles: ContractBlock['roles'] = carousel ? ['cover', 'repeat', 'ending'] : ['cover']
  return {
    roles,
    slideCap: format.slideCap,
    carousel,
    helper: carousel
      ? `Cover is the first slide. Long pieces fill Repeat slides (up to ${format.slideCap}) and end on Ending.`
      : 'This format is a single image. Design the Cover.',
    rows: roles.map((role) => ({
      role,
      ...CONTRACT_LABELS[role],
      present: role === 'cover',
      met: role === 'cover',
      words: SMOKE_ROW_WORDS[role]
    })),
    unusedRoles: []
  }
}

/** The `GET /api/studio/templates/<id>` answer — the app's `StudioTemplatePayload` over the smoke fixture. */
function templatePayload(options: APIOptions, ai: AIBlock, name: string, version: number) {
  return {
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
      vocabulary: options.vocabulary ?? VOCABULARY,
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
    },
    // Track FB-61: absent (`contract: null`) on an older app; otherwise the app's block.
    ...(options.contract === null
      ? {}
      : { contract: options.contract ?? contractFor(options.format ?? FORMAT) })
  }
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
      const arabic = options.candidates ?? [CANDIDATE]
      if (options.kinds === null) return route.fulfill({ json: { candidates: arabic } })
      // H-70: the app's shape — `groups` + the flat concatenation, Arabic first.
      const kinds = options.kinds ?? [KIND_CANDIDATE]
      return route.fulfill({
        json: {
          candidates: [...arabic, ...kinds],
          groups: [
            { key: 'arabic', label: GROUP_LABELS.arabic, candidates: arabic },
            { key: 'kinds', label: GROUP_LABELS.kinds, candidates: kinds }
          ]
        }
      })
    }
    if (url.pathname === `/api/studio/templates/${TEMPLATE_ID}`) {
      if (request.headers()['authorization'] !== 'Bearer smoke-token') {
        return route.fulfill({ status: 401, json: { error: 'unauthorized' } })
      }
      if (request.method() === 'GET') {
        return route.fulfill({ json: templatePayload(options, ai, name, version) })
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
            template: {
              id: TEMPLATE_ID,
              key: 'kuwaiti_card',
              label: 'Kuwaiti card',
              version: 3
            },
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
          return route.fulfill({
            status: 400,
            json: { error: 'no_draft_slot' }
          })
        }
        if (body.baseVersion !== version) {
          return route.fulfill({
            status: 409,
            json: {
              error: 'conflict',
              currentVersion: version,
              currentDesignId: currentId
            }
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
