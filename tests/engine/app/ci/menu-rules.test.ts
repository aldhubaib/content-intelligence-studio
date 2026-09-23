// CI: Track E3d-c — which File-menu entries each hosted mode shows.
import { describe, expect, test } from 'bun:test'

import { hidesMenuItem } from '@/app/ci/menu-rules'

describe('hidesMenuItem', () => {
  test('standalone shows every upstream entry and none of the hosted ones', () => {
    expect(hidesMenuItem('new', null)).toBe(false)
    expect(hidesMenuItem('save-as', null)).toBe(false)
    expect(hidesMenuItem('ci-back-to-templates', null)).toBe(true)
    expect(hidesMenuItem('ci-back-to-post', null)).toBe(true)
    expect(hidesMenuItem('ci-save-as-new-template', null)).toBe(true)
    expect(hidesMenuItem('ci-open-in-new-tab', null)).toBe(true)
  })

  test('a template session: Back to templates + Save as new template, never Back to post', () => {
    for (const id of ['new', 'open', 'open-recent', 'save-as', 'export-fig', 'autosave', 'close'])
      expect(hidesMenuItem(id, 'template')).toBe(true)
    expect(hidesMenuItem('ci-back-to-templates', 'template')).toBe(false)
    expect(hidesMenuItem('ci-save-as-new-template', 'template')).toBe(false)
    expect(hidesMenuItem('ci-open-in-new-tab', 'template')).toBe(false)
    expect(hidesMenuItem('ci-back-to-post', 'template')).toBe(true)
    expect(hidesMenuItem('save', 'template')).toBe(false)
  })

  test('a design session: Back to post · Save version · Export image… · Open in new tab only', () => {
    for (const id of ['new', 'open', 'open-recent', 'save-as', 'export-fig', 'autosave', 'close'])
      expect(hidesMenuItem(id, 'design')).toBe(true)
    expect(hidesMenuItem('ci-back-to-post', 'design')).toBe(false)
    expect(hidesMenuItem('save', 'design')).toBe(false)
    expect(hidesMenuItem('export-selection', 'design')).toBe(false)
    expect(hidesMenuItem('ci-open-in-new-tab', 'design')).toBe(false)
    expect(hidesMenuItem('ci-back-to-templates', 'design')).toBe(true)
    expect(hidesMenuItem('ci-save-as-new-template', 'design')).toBe(true)
  })
})
