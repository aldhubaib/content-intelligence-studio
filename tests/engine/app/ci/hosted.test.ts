// CI: hosted-mode configuration parsing.
import { describe, expect, test } from 'bun:test'

import { parseHostedConfig } from '@/app/ci/hosted'

describe('parseHostedConfig', () => {
  test('returns null when `doc` is absent (standalone OpenPencil)', () => {
    expect(parseHostedConfig('')).toBeNull()
    expect(parseHostedConfig('?recent-files&test')).toBeNull()
  })

  test('reads the four hosted parameters and normalises the api origin', () => {
    const config = parseHostedConfig(
      '?doc=3f1c2c4e-0f2a-4e1b-9c1d-1a2b3c4d5e6f&ws=nizek&token=abc.def&api=https://app.example.com/some/path'
    )
    expect(config).toEqual({
      templateId: '3f1c2c4e-0f2a-4e1b-9c1d-1a2b3c4d5e6f',
      workspaceSlug: 'nizek',
      apiOrigin: 'https://app.example.com',
      initialToken: 'abc.def'
    })
  })

  test('refuses a partial set instead of silently falling back to standalone', () => {
    expect(() => parseHostedConfig('?doc=abc&ws=nizek&api=https://a.b')).toThrow(/token/)
    expect(() => parseHostedConfig('?doc=abc&ws=nizek&token=t&api=not-a-url')).toThrow(/api/)
    expect(() => parseHostedConfig('?doc=../etc&ws=nizek&token=t&api=https://a.b')).toThrow(/doc/)
    expect(() => parseHostedConfig('?doc=abc&token=t&api=javascript:alert(1)')).toThrow(/api/)
  })
})
