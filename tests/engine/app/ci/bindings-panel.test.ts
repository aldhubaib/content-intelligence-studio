// CI: the Bindings panel's own rules — collapsed by default when the template is
// Usable and every contract role is met, open otherwise; a remembered toggle wins;
// a brand-text chip is named by the role frame that holds its layer (FB-78, PATCHES H-72).
import { describe, expect, test } from 'bun:test'

import type { BindingRef, RoleReport } from '@/app/ci/bindings'
import {
  BINDINGS_OPEN_STORAGE_KEY,
  bindingsDefaultOpen,
  brandTextChipWords,
  nothingBound,
  parseStoredBindingsOpen,
  resolveBindingsOpen,
  serializeBindingsOpen
} from '@/app/ci/bindings-panel'

function binding(name: string, frameId: string | null, nodeName = name): BindingRef {
  return {
    name,
    binding: { kind: 'content', slot: name.replace(/^content:/, '') },
    nodeId: `${frameId ?? 'stray'}:${name}`,
    nodeName,
    nodeType: 'TEXT',
    frameId,
    maxChars: null
  } as BindingRef
}

function role(
  name: RoleReport['role'],
  frameId: string | null,
  bindings: BindingRef[],
  inContract = true
): RoleReport {
  return {
    role: name,
    inContract,
    present: frameId !== null,
    frameId,
    bindings,
    status: 'ok',
    reasons: []
  } as RoleReport
}

const coverMet = role('cover', '0:3', [binding('content:title', '0:3')])
const repeatMet = role('repeat', '0:9', [binding('content:body', '0:9')])
const endingEmpty = role('ending', null, [])

const usable = { single: true, carousel: true }
const notUsable = { single: false, carousel: false }

describe('bindingsDefaultOpen — collapsed only when there is nothing left to do', () => {
  test('Usable and every contract row met → collapsed', () => {
    const report = { roles: [coverMet, repeatMet, endingEmpty], strayBindings: [], usable }
    const checklist = [{ met: true }, { met: true }, { met: true }]
    expect(bindingsDefaultOpen(report, checklist)).toBe(false)
  })

  test('a contract row not met → open, even while the single image is Usable', () => {
    const report = {
      roles: [coverMet, role('repeat', null, []), endingEmpty],
      strayBindings: [],
      usable: { single: true, carousel: false }
    }
    const checklist = [{ met: true }, { met: false }, { met: false }]
    expect(bindingsDefaultOpen(report, checklist)).toBe(true)
  })

  test('Not usable yet → open regardless of the checklist words', () => {
    const report = { roles: [role('cover', '0:3', [])], strayBindings: [], usable: notUsable }
    expect(bindingsDefaultOpen(report, [{ met: true }])).toBe(true)
  })

  test('a fresh document with nothing bound → open', () => {
    const report = { roles: [role('cover', '0:3', []), endingEmpty], strayBindings: [], usable }
    expect(nothingBound(report)).toBe(true)
    expect(bindingsDefaultOpen(report, [{ met: true }])).toBe(true)
  })

  test('a stray binding outside every role frame counts as something bound', () => {
    const report = {
      roles: [role('cover', '0:3', [])],
      strayBindings: [binding('content:title', null)],
      usable: notUsable
    }
    expect(nothingBound(report)).toBe(false)
  })

  test('no report yet (still loading) → open', () => {
    expect(bindingsDefaultOpen(null, [])).toBe(true)
  })
})

describe('the remembered toggle', () => {
  test('a stored toggle wins over the default in both directions', () => {
    expect(resolveBindingsOpen(false, true)).toBe(false)
    expect(resolveBindingsOpen(true, false)).toBe(true)
  })

  test('nothing stored → the default', () => {
    expect(resolveBindingsOpen(null, true)).toBe(true)
    expect(resolveBindingsOpen(null, false)).toBe(false)
  })

  test('the stored words round-trip; anything else reads as not stored', () => {
    expect(parseStoredBindingsOpen(serializeBindingsOpen(true))).toBe(true)
    expect(parseStoredBindingsOpen(serializeBindingsOpen(false))).toBe(false)
    expect(parseStoredBindingsOpen('')).toBeNull()
    expect(parseStoredBindingsOpen(null)).toBeNull()
    expect(parseStoredBindingsOpen(undefined)).toBeNull()
    expect(parseStoredBindingsOpen('yes')).toBeNull()
  })

  test("the key lives in the Studio's own family, beside the palette key", () => {
    expect(BINDINGS_OPEN_STORAGE_KEY).toBe('content-intelligence:studio-bindings-open')
    expect(BINDINGS_OPEN_STORAGE_KEY.startsWith('content-intelligence:studio-')).toBe(true)
  })
})

describe('brandTextChipWords — a chip is named by the role frame holding its layer', () => {
  const roles = [coverMet, repeatMet, endingEmpty]

  test('a layer inside the cover frame reads "cover", inside the repeat frame "repeat"', () => {
    expect(brandTextChipWords(binding('brand:handle', '0:3', 'Handle'), roles)).toBe('cover')
    expect(brandTextChipWords(binding('brand:handle', '0:9', 'Handle'), roles)).toBe('repeat')
  })

  test('a layer outside every role frame reads its own layer name', () => {
    expect(brandTextChipWords(binding('brand:handle', '0:77', 'Handle copy'), roles)).toBe(
      'Handle copy'
    )
    expect(brandTextChipWords(binding('brand:handle', null, 'brand:handle'), roles)).toBe(
      'brand:handle'
    )
  })

  test('an absent role never matches a null frame id', () => {
    expect(brandTextChipWords(binding('brand:handle', null, 'Loose'), [endingEmpty])).toBe('Loose')
  })
})
