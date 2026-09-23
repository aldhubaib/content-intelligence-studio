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
import type { BindingsReport } from '@/app/ci/bindings'

const brand: StudioBrand = {
  workspaceName: 'Nizek',
  colors: { primary: '#0f62fe', secondary: '#393939' },
  assets: [
    {
      id: 'a1',
      name: 'Hero',
      url: 'https://app.example.com/api/studio/templates/t/assets/a1',
      kind: 'user-image',
      isDefault: true,
      contentType: 'image/png'
    }
  ]
}

const emptyBindings: BindingsReport = {
  version: 'bindings-v3',
  roles: [],
  strayBindings: [],
  usable: { single: false, carousel: false }
}

const ctx: AIPresetContext = {
  brand,
  bindings: {
    version: 'bindings-v3',
    roles: [
      {
        role: 'cover',
        present: true,
        frameId: 'f1',
        status: 'ok',
        reasons: [{ code: 'repeat_without_body' }],
        bindings: [
          {
            name: 'content:title',
            binding: { kind: 'content', slot: 'title' },
            nodeId: 'n1',
            nodeName: 'content:title',
            nodeType: 'TEXT',
            frameId: 'f1'
          },
          {
            name: 'content:image',
            binding: { kind: 'content', slot: 'image' },
            nodeId: 'n2',
            nodeName: 'content:image',
            nodeType: 'RECTANGLE',
            frameId: 'f1'
          }
        ]
      },
      {
        role: 'repeat',
        present: true,
        frameId: 'f2',
        status: 'missing',
        reasons: [{ code: 'repeat_without_body' }],
        bindings: []
      },
      {
        role: 'ending',
        present: false,
        frameId: null,
        status: 'missing',
        reasons: [],
        bindings: []
      }
    ],
    strayBindings: [],
    usable: { single: true, carousel: false }
  },
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
    expect(s.modelText).toContain('$brand/primary (#0f62fe) and $brand/secondary (#393939)')
    expect(s.modelText).toContain('brand:user-image:Hero')
    expect(s.modelText).toContain('content:title, content:image')
    expect(s.modelText).toContain('Still missing: repeat has no content:body.')
    expect(s.modelText).toContain('Text slots: title.')
    expect(s.modelText).toContain('Do not export, render or fetch anything.')
  })

  test('each preset carries its own task and the shared closing rule', () => {
    const texts = AI_PRESETS.map((p) => buildPresetSubmission(p.id, ctx).modelText)
    expect(texts[1]).toContain('Brand variable')
    expect(texts[2]).toContain('exactly three variants')
    expect(texts[3]).toContain('safe area')
    for (const t of texts)
      expect(t).toContain('keep every content:<slot> and brand:<kind> layer name')
    expect(new Set(texts).size).toBe(4)
  })

  test('without a brand kit or a frame the grounding says so; the selection is named and capped', () => {
    const s = buildPresetSubmission('brand-colours', {
      ...ctx,
      brand: null,
      frame: null,
      bindings: emptyBindings,
      selection: ['A', 'B', 'C', 'D', 'E', 'F', 'G']
    })
    expect(s.modelText).toContain('No brand kit is bound')
    expect(s.modelText).toContain('Use the first frame on the current page')
    expect(s.modelText).toContain('No content: or brand: layers are bound yet.')
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
