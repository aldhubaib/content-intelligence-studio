// CI: hosted AI presets (ADR-061 §5, Track E4 Part C).
import { describe, expect, test } from 'bun:test'

import {
  AI_PRESETS,
  buildPresetSubmission,
  primaryFrameOf,
  selectionNames,
  type AIPresetContext
} from '@/app/ci/ai-presets'
import type { StudioBrand } from '@/app/ci/api'

const brand: StudioBrand = {
  workspaceName: 'Nizek',
  colors: {
    primary: '#0f62fe',
    secondary: '#393939',
    accent: '#ff832b',
    background: '#161616',
    text: '#f4f4f4'
  },
  fontArabicFamily: 'IBM Plex Sans Arabic',
  fontLatinFamily: 'IBM Plex Sans',
  watermarkText: null,
  assets: []
}

const ctx: AIPresetContext = {
  brand,
  slots: {
    bindings: [
      { slot: 'headline', nodeId: 'n1', nodeName: 'slot:headline', maxChars: 80 },
      { slot: 'cover', nodeId: 'n2', nodeName: 'slot:cover' }
    ],
    missingRequired: ['body'],
    duplicates: []
  },
  requiredSlots: ['headline', 'body', 'cover'],
  frame: { width: 1080, height: 1350 },
  selection: []
}

describe('ai presets', () => {
  test('four chips in the fixed order', () => {
    expect(AI_PRESETS.map((p) => p.id)).toEqual([
      'fit-arabic',
      'brand-colours',
      'variants',
      'safe-areas'
    ])
    expect(AI_PRESETS.map((p) => p.label)).toEqual([
      'Fit Arabic copy',
      'Apply brand colours',
      'Propose 3 variants',
      'Check safe areas'
    ])
  })

  test('the display text is the chip label; the model text is grounded in frame, brand and slots', () => {
    const s = buildPresetSubmission('fit-arabic', ctx)
    expect(s.displayText).toBe('Fit Arabic copy')
    expect(s.modelText).toContain('RTL')
    expect(s.modelText).toContain('The primary frame is 1080×1350 px.')
    expect(s.modelText).toContain('IBM Plex Sans Arabic')
    expect(s.modelText).toContain('slot:headline, slot:cover')
    expect(s.modelText).toContain('Required slots still missing: body.')
    expect(s.modelText).toContain('Text slots: headline.')
    expect(s.modelText).toContain('Do not export, render or fetch anything.')
    // Colours travel by role, never as hex — the model binds variables.
    expect(s.modelText).not.toMatch(/#[0-9a-f]{6}/i)
  })

  test('each preset carries its own task and the shared closing rule', () => {
    const texts = AI_PRESETS.map((p) => buildPresetSubmission(p.id, ctx).modelText)
    expect(texts[1]).toContain('Brand variable')
    expect(texts[2]).toContain('exactly three variants')
    expect(texts[3]).toContain('safe area')
    for (const t of texts) expect(t).toContain('keep every slot:<name> layer name')
    expect(new Set(texts).size).toBe(4)
  })

  test('without a brand kit or a frame the grounding says so; the selection is named and capped', () => {
    const s = buildPresetSubmission('brand-colours', {
      ...ctx,
      brand: null,
      frame: null,
      slots: { bindings: [], missingRequired: [], duplicates: [] },
      selection: ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    })
    expect(s.modelText).toContain('No brand kit is bound')
    expect(s.modelText).toContain('Use the first frame on the current page')
    expect(s.modelText).toContain('No slot layers are bound yet.')
    expect(s.modelText).toContain('Work on the selection first (A, B, C, D, E, …).')
  })

  test('helpers: first FRAME child is the primary frame; empty names are dropped', () => {
    expect(
      primaryFrameOf([
        { type: 'TEXT', width: 10, height: 10 },
        { type: 'FRAME', width: 1080.4, height: 1349.6 }
      ])
    ).toEqual({ width: 1080, height: 1350 })
    expect(primaryFrameOf([{ type: 'TEXT' }])).toBeNull()
    expect(selectionNames([{ name: 'Logo' }, { name: '' }])).toEqual(['Logo'])
  })

  test('an unknown preset id is refused', () => {
    expect(() => buildPresetSubmission('nope' as never, ctx)).toThrow(/Unknown AI preset/)
  })
})
