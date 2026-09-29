// CI: Preview with real content — the pure half (Track E3d-b1, FB-44 §6).
import { describe, expect, test } from 'bun:test'

import type { StudioPreviewCandidate, StudioPreviewContent } from '@/app/ci/api'
import {
  PREVIEW_COPY,
  candidateRowTitle,
  contentOf,
  contentPreviewChanges,
  contentTextFor,
  estimateBoxChars,
  isPreviewTextSlot,
  preselectedCandidate,
  previewGroupsOf,
  relativeTimeWords,
  remapStyleRuns,
  selectionWords,
  stepIndexesFor,
  truncateWithEllipsis
} from '@/app/ci/preview'

const CONTENT: StudioPreviewContent = {
  title: 'عنوان',
  subtitle: '',
  body: 'نص طويل يشرح الفكرة بالتفصيل ويستمر إلى أن يملأ الصندوق ويزيد عنه بكثير جداً',
  cta: 'اعرف أكثر',
  articleUrl: 'https://example.invalid/articles/preview'
}

const CANDIDATE: StudioPreviewCandidate = {
  ...CONTENT,
  id: 'cand-1',
  format: 'LINKEDIN_POST',
  formatLabel: 'LinkedIn Post',
  approvedAt: '2026-09-23T10:00:00Z',
  imageUrl: null
}

describe('content slots', () => {
  test('text slots read their field; an empty value and an image slot give null', () => {
    expect(contentTextFor('title', CONTENT)).toBe('عنوان')
    expect(contentTextFor('article-url', CONTENT)).toBe(CONTENT.articleUrl)
    expect(contentTextFor('subtitle', CONTENT)).toBeNull()
    expect(contentTextFor('image', CONTENT)).toBeNull()
    expect(contentTextFor('ai-image', CONTENT)).toBeNull()
  })

  test('the selection resolves to a candidate, the sample, or nothing', () => {
    const sample = { ...CONTENT, title: 'sample' }
    expect(contentOf({ kind: 'none' }, sample)).toBeNull()
    expect(contentOf({ kind: 'sample' }, sample)).toBe(sample)
    expect(contentOf({ kind: 'sample' }, null)).toBeNull()
    expect(contentOf({ kind: 'candidate', candidate: CANDIDATE }, sample)).toBe(CANDIDATE)
  })

  test('the button reads the selection', () => {
    expect(selectionWords({ kind: 'none' })).toBe(PREVIEW_COPY.button)
    expect(selectionWords({ kind: 'sample' })).toBe('Preview: Sample text')
    expect(selectionWords({ kind: 'candidate', candidate: CANDIDATE })).toBe('Preview: عنوان')
  })
})

describe('truncation', () => {
  test('cuts on a word boundary with an ellipsis, keeps a fitting text as written', () => {
    expect(truncateWithEllipsis('abc def ghi', 20)).toBe('abc def ghi')
    expect(truncateWithEllipsis('abc def ghi', 8)).toBe('abc def…')
    expect(truncateWithEllipsis('abcdefghij', 5)).toBe('abcd…')
    expect(truncateWithEllipsis('abc', 0)).toBe('')
  })

  test('the box estimate follows width / height / font, and maxChars wins', () => {
    const node = { width: 550, height: 120, fontSize: 20, lineHeight: null }
    // 550 / (20 · 0.55) = 50 per line · 120 / 24 = 5 lines
    expect(estimateBoxChars(node)).toBe(250)
    expect(estimateBoxChars({ ...node, lineHeight: 40 })).toBe(150)
    expect(estimateBoxChars(node, 42)).toBe(42)
  })
})

describe('style runs', () => {
  const runs = [
    { start: 0, length: 5, style: { fontWeight: 700 } },
    { start: 5, length: 5, style: { italic: true } }
  ]

  test('a run reaching the old end stretches to the new end; inner runs are clamped or dropped', () => {
    expect(remapStyleRuns(runs, 10, 20)).toEqual([
      { start: 0, length: 5, style: { fontWeight: 700 } },
      { start: 5, length: 15, style: { italic: true } }
    ])
    expect(remapStyleRuns(runs, 10, 3)).toEqual([
      { start: 0, length: 3, style: { fontWeight: 700 } }
    ])
    expect(remapStyleRuns([{ start: 0, length: 10, style: {} }], 10, 4)).toEqual([
      { start: 0, length: 4, style: {} }
    ])
  })
})

describe('contentPreviewChanges', () => {
  const text = {
    text: 'placeholder',
    styleRuns: [],
    width: 500,
    height: 60,
    fontSize: 24,
    lineHeight: null
  }

  test('a cover title takes the whole value and keeps the box; runs are remapped', () => {
    expect(
      contentPreviewChanges(text, 'title', CONTENT, { role: 'cover', maxChars: null })
    ).toEqual({
      text: 'عنوان'
    })
    const styled = { ...text, styleRuns: [{ start: 0, length: 11, style: { fontWeight: 700 } }] }
    expect(
      contentPreviewChanges(styled, 'title', CONTENT, { role: 'cover', maxChars: null })
    ).toEqual({
      text: 'عنوان',
      styleRuns: [{ start: 0, length: 5, style: { fontWeight: 700 } }]
    })
  })

  test('a repeat body is the first chunk — the body truncated to the box with …', () => {
    const body = { ...text, width: 200, height: 30, fontSize: 20 } // 18 per line · 1 line
    const changes = contentPreviewChanges(body, 'body', CONTENT, { role: 'repeat', maxChars: null })
    expect(changes?.text?.endsWith('…')).toBe(true)
    expect((changes?.text ?? '').length).toBeLessThanOrEqual(18)
    // The cover shows the whole body, however long.
    expect(contentPreviewChanges(body, 'body', CONTENT, { role: 'cover', maxChars: null })).toEqual(
      {
        text: CONTENT.body
      }
    )
    expect(
      contentPreviewChanges(body, 'body', CONTENT, { role: 'repeat', maxChars: 10 })?.text.length
    ).toBeLessThanOrEqual(10)
  })

  test("E3d-c: a repeat body shows the design copy's first chunk when the post carries one", () => {
    const body = { ...text, width: 200, height: 30, fontSize: 20 }
    const chunked = { ...CONTENT, bodyChunks: ['الجزء الأول من النص', 'الجزء الثاني'] }
    expect(
      contentPreviewChanges(body, 'body', chunked, { role: 'repeat', maxChars: null })
    ).toEqual({ text: 'الجزء الأول من النص' })
    // The cover still shows the whole body; an empty chunk list falls back to truncation.
    expect(contentPreviewChanges(body, 'body', chunked, { role: 'cover', maxChars: null })).toEqual(
      { text: CONTENT.body }
    )
    const none = { ...CONTENT, bodyChunks: [] }
    expect(
      contentPreviewChanges(body, 'body', none, { role: 'repeat', maxChars: null })?.text.endsWith(
        '…'
      )
    ).toBe(true)
  })

  test('an empty value or an image slot yields nothing', () => {
    expect(
      contentPreviewChanges(text, 'subtitle', CONTENT, { role: 'cover', maxChars: null })
    ).toBeNull()
    expect(
      contentPreviewChanges(text, 'image', CONTENT, { role: 'cover', maxChars: null })
    ).toBeNull()
  })
})

describe('menu words', () => {
  test('relative time', () => {
    const now = new Date('2026-09-23T12:00:00Z')
    expect(relativeTimeWords('2026-09-23T11:59:40Z', now)).toBe('just now')
    expect(relativeTimeWords('2026-09-23T11:45:00Z', now)).toBe('15 min ago')
    expect(relativeTimeWords('2026-09-23T09:00:00Z', now)).toBe('3 h ago')
    expect(relativeTimeWords('2026-09-21T12:00:00Z', now)).toBe('2 d ago')
    expect(relativeTimeWords('2026-08-01T12:00:00Z', now)).toMatch(/2026/)
    expect(relativeTimeWords('nope', now)).toBe('')
  })

  test('?preview= preselects only a listed candidate', () => {
    expect(preselectedCandidate([CANDIDATE], 'cand-1')).toBe(CANDIDATE)
    expect(preselectedCandidate([CANDIDATE], 'cand-9')).toBeNull()
    expect(preselectedCandidate([CANDIDATE], null)).toBeNull()
  })
})

// CI: Track fb74-studio-preview-kinds (H-70) — article kinds as the second section.
const STEPS = ['احذف اجتماعًا.', 'اكتب جدولًا.', 'أنهِ الاجتماع.']
const KIND: StudioPreviewCandidate = {
  id: 'kind:piece-1:how_to',
  title: 'كيف تقلل الاجتماعات',
  subtitle: 'إنتاجية',
  body: STEPS.join('\n'),
  cta: 'ابدأ اليوم.',
  articleUrl: 'https://example.invalid/articles/preview',
  bodyChunks: STEPS,
  slots: { number: '٣', step: STEPS },
  format: null,
  formatLabel: null,
  approvedAt: '2026-09-23T10:00:00Z',
  imageUrl: null,
  kind: { key: 'how_to', nameEn: 'How-to', nameAr: 'خطوات', pieceTitle: 'أسبوع بلا اجتماعات' }
}

describe('H-70 kind slots', () => {
  test('number and step are text slots; they read slots.*, an Arabic candidate paints neither', () => {
    expect(isPreviewTextSlot('number')).toBe(true)
    expect(isPreviewTextSlot('step')).toBe(true)
    expect(contentTextFor('number', KIND)).toBe('٣')
    expect(contentTextFor('step', KIND, 0)).toBe(STEPS[0])
    expect(contentTextFor('step', KIND, 2)).toBe(STEPS[2])
    expect(contentTextFor('step', KIND, 3)).toBeNull() // past the last step
    expect(contentTextFor('step', KIND)).toBeNull() // no index — a layer outside cover / repeat
    expect(contentTextFor('number', CONTENT)).toBeNull()
    expect(contentTextFor('step', CONTENT, 0)).toBeNull()
    expect(contentTextFor('number', { ...KIND, slots: { number: '  ' } })).toBeNull()
  })

  test('step layers are numbered cover first, then each repeat frame in paint order; ending / unframed get none', () => {
    const ROLES: Record<string, 'cover' | 'repeat' | 'ending'> = {
      cover: 'cover',
      'repeat-1': 'repeat',
      'repeat-2': 'repeat',
      ending: 'ending'
    }
    const role = (frameId: string) => ROLES[frameId] ?? null
    const indexes = stepIndexesFor(
      [
        { nodeId: 'r2-a', slot: 'step', frameId: 'repeat-2' },
        { nodeId: 'r1-a', slot: 'step', frameId: 'repeat-1' },
        { nodeId: 'e-a', slot: 'step', frameId: 'ending' },
        { nodeId: 'c-a', slot: 'step', frameId: 'cover' },
        { nodeId: 'c-body', slot: 'body', frameId: 'cover' },
        { nodeId: 'c-b', slot: 'step', frameId: 'cover' },
        { nodeId: 'loose', slot: 'step', frameId: null },
        { nodeId: 'x', slot: 'step', frameId: 'unnamed' }
      ],
      role
    )
    // Paint order inside a role is kept; cover before every repeat regardless of frame order.
    expect([...indexes.entries()]).toEqual([
      ['c-a', 0],
      ['c-b', 1],
      ['r2-a', 2],
      ['r1-a', 3]
    ])
    expect(indexes.has('e-a')).toBe(false)
    expect(indexes.has('loose')).toBe(false)
    expect(indexes.has('x')).toBe(false)
    expect(indexes.has('c-body')).toBe(false)
  })

  test('contentPreviewChanges paints the N-th step on the N-th step layer and the first chunk on a repeat body', () => {
    const node = {
      text: 'الخطوة',
      styleRuns: [],
      width: 900,
      height: 80,
      fontSize: 32,
      lineHeight: null
    }
    expect(
      contentPreviewChanges(node, 'step', KIND, { role: 'cover', maxChars: null, stepIndex: 0 })
    ).toEqual({ text: STEPS[0] })
    expect(
      contentPreviewChanges(node, 'step', KIND, { role: 'repeat', maxChars: null, stepIndex: 1 })
    ).toEqual({ text: STEPS[1] })
    expect(
      contentPreviewChanges(node, 'step', KIND, { role: 'ending', maxChars: null, stepIndex: null })
    ).toBeNull()
    expect(contentPreviewChanges(node, 'number', KIND, { role: 'cover', maxChars: null })).toEqual({
      text: '٣'
    })
    expect(contentPreviewChanges(node, 'body', KIND, { role: 'repeat', maxChars: null })).toEqual({
      text: STEPS[0]
    })
  })

  test('the row and button words read "<Kind> · <piece title>", the kind name alone without one', () => {
    expect(candidateRowTitle(KIND)).toBe('How-to · أسبوع بلا اجتماعات')
    expect(
      candidateRowTitle({
        ...KIND,
        kind: { key: 'how_to', nameEn: 'How-to', nameAr: 'خطوات', pieceTitle: '' }
      })
    ).toBe('How-to')
    expect(candidateRowTitle(CANDIDATE)).toBe('عنوان')
    expect(selectionWords({ kind: 'candidate', candidate: KIND })).toBe(
      'Preview: How-to · أسبوع بلا اجتماعات'
    )
    expect(PREVIEW_COPY.kindsHeading).toBe('Article kinds')
    expect(PREVIEW_COPY.written('3 h ago')).toBe('Written 3 h ago')
  })

  test('previewGroupsOf: groups when sent (flat list = every candidate once), one Arabic section for an older app', () => {
    const sent = previewGroupsOf({
      candidates: [CANDIDATE, KIND],
      groups: [
        { key: 'arabic', label: 'Approved Arabic candidates', candidates: [CANDIDATE] },
        { key: 'kinds', label: 'Article kinds', candidates: [KIND] }
      ]
    })
    expect(sent.groups.map((g) => [g.key, g.label, g.candidates.length])).toEqual([
      ['arabic', 'Approved Arabic candidates', 1],
      ['kinds', 'Article kinds', 1]
    ])
    expect(sent.candidates.map((c) => c.id)).toEqual(['cand-1', 'kind:piece-1:how_to'])
    // An app that sends groups but a shorter flat list: the flat list still holds every group's candidate, once.
    const partial = previewGroupsOf({
      candidates: [CANDIDATE],
      groups: [
        { key: 'arabic', label: 'Approved Arabic candidates', candidates: [CANDIDATE] },
        { key: 'kinds', label: 'Article kinds', candidates: [KIND] }
      ]
    })
    expect(partial.candidates.map((c) => c.id)).toEqual(['cand-1', 'kind:piece-1:how_to'])
    const older = previewGroupsOf({ candidates: [CANDIDATE] })
    expect(older.groups).toEqual([
      { key: 'arabic', label: PREVIEW_COPY.heading, candidates: [CANDIDATE] }
    ])
    expect(older.candidates).toEqual([CANDIDATE])
    expect(previewGroupsOf({})).toEqual({
      candidates: [],
      groups: [{ key: 'arabic', label: PREVIEW_COPY.heading, candidates: [] }]
    })
    // `?preview=kind:…` finds the kind through the flat list.
    expect(preselectedCandidate(sent.candidates, 'kind:piece-1:how_to')).toBe(KIND)
  })
})
