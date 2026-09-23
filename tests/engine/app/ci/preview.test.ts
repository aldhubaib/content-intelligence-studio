// CI: Preview with real content — the pure half (Track E3d-b1, FB-44 §6).
import { describe, expect, test } from 'bun:test'

import type { StudioPreviewCandidate, StudioPreviewContent } from '@/app/ci/api'
import {
  PREVIEW_COPY,
  contentOf,
  contentPreviewChanges,
  contentTextFor,
  estimateBoxChars,
  preselectedCandidate,
  relativeTimeWords,
  remapStyleRuns,
  selectionWords,
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
    expect(remapStyleRuns(runs, 10, 3)).toEqual([{ start: 0, length: 3, style: { fontWeight: 700 } }])
    expect(remapStyleRuns([{ start: 0, length: 10, style: {} }], 10, 4)).toEqual([
      { start: 0, length: 4, style: {} }
    ])
  })
})

describe('contentPreviewChanges', () => {
  const text = { text: 'placeholder', styleRuns: [], width: 500, height: 60, fontSize: 24, lineHeight: null }

  test('a cover title takes the whole value and keeps the box; runs are remapped', () => {
    expect(contentPreviewChanges(text, 'title', CONTENT, { role: 'cover', maxChars: null })).toEqual({
      text: 'عنوان'
    })
    const styled = { ...text, styleRuns: [{ start: 0, length: 11, style: { fontWeight: 700 } }] }
    expect(contentPreviewChanges(styled, 'title', CONTENT, { role: 'cover', maxChars: null })).toEqual({
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
    expect(contentPreviewChanges(body, 'body', CONTENT, { role: 'cover', maxChars: null })).toEqual({
      text: CONTENT.body
    })
    expect(contentPreviewChanges(body, 'body', CONTENT, { role: 'repeat', maxChars: 10 })?.text.length).toBeLessThanOrEqual(10)
  })

  test('an empty value or an image slot yields nothing', () => {
    expect(contentPreviewChanges(text, 'subtitle', CONTENT, { role: 'cover', maxChars: null })).toBeNull()
    expect(contentPreviewChanges(text, 'image', CONTENT, { role: 'cover', maxChars: null })).toBeNull()
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
