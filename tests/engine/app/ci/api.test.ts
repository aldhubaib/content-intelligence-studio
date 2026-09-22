// CI: Studio API client over a mocked fetch.
import { describe, expect, test } from 'bun:test'

import {
  StudioAPIError,
  StudioConflictError,
  StudioUnauthorizedError,
  createStudioAPI
} from '@/app/ci/api'
import { DOCUMENT_FORMAT, type SerializedDocument } from '@/app/ci/document'

const emptyDocument: SerializedDocument = {
  documentFormat: DOCUMENT_FORMAT,
  schemaVersion: 1,
  engineVersion: '0.15.1',
  graph: {
    rootId: 'root',
    nodes: [['root', { type: 'DOCUMENT', childIds: [] }]],
    images: [],
    variables: [],
    variableCollections: [],
    activeMode: [],
    documentColorSpace: 'sRGB'
  }
}

function mockFetch(handler: (url: URL, init: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ url: URL; init: RequestInit }> = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof URL ? input : new URL(String(input))
    calls.push({ url, init: init ?? {} })
    return handler(url, init ?? {})
  }) as typeof fetch
  return { fetcher, calls }
}

function api(fetcher: typeof fetch, token = 'tok-1') {
  return createStudioAPI({
    apiOrigin: 'https://app.example.com',
    templateId: 'tpl-1',
    token: () => token,
    fetch: fetcher
  })
}

describe('createStudioAPI', () => {
  test('GET carries the bearer and returns the payload', async () => {
    const payload = {
      document: emptyDocument,
      name: 'Card',
      version: 3,
      updatedAt: 'now',
      brand: null,
      fonts: [],
      requiredSlots: ['headline'],
      ai: { enabled: true }
    }
    const { fetcher, calls } = mockFetch(() => Response.json(payload))
    const result = await api(fetcher).loadTemplate()
    expect(result.version).toBe(3)
    expect(calls[0].url.href).toBe('https://app.example.com/api/studio/templates/tpl-1')
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer tok-1')
    expect(calls[0].init.credentials).toBe('omit')
  })

  test('PUT sends the save body and maps 409 / 401 / 5xx to typed errors', async () => {
    const { fetcher, calls } = mockFetch((_, init) => {
      const body = JSON.parse(String(init.body)) as { kind: string; baseVersion: number }
      if (body.baseVersion === 1) return Response.json({ version: 2, updatedAt: 'later' })
      if (body.baseVersion === 2)
        return Response.json({ error: { code: 'conflict' }, currentVersion: 5 }, { status: 409 })
      if (body.baseVersion === 3) return new Response('', { status: 401 })
      return Response.json(
        { error: { code: 'boom', message: 'Database is away' } },
        { status: 500 }
      )
    })
    const client = api(fetcher)
    const ok = await client.saveTemplate({ document: emptyDocument, baseVersion: 1, kind: 'draft' })
    expect(ok).toEqual({ version: 2, updatedAt: 'later' })
    expect(calls[0].init.method).toBe('PUT')

    const conflict = client.saveTemplate({
      document: emptyDocument,
      baseVersion: 2,
      kind: 'version'
    })
    await expect(conflict).rejects.toBeInstanceOf(StudioConflictError)
    await conflict.catch((error: StudioConflictError) => expect(error.currentVersion).toBe(5))

    await expect(
      client.saveTemplate({ document: emptyDocument, baseVersion: 3, kind: 'version' })
    ).rejects.toBeInstanceOf(StudioUnauthorizedError)

    const failed = client.saveTemplate({ document: emptyDocument, baseVersion: 4, kind: 'version' })
    await expect(failed).rejects.toBeInstanceOf(StudioAPIError)
    await failed.catch((error: StudioAPIError) => {
      expect(error.status).toBe(500)
      expect(error.message).toBe('Database is away')
    })
  })

  test('refuses to fetch bytes from any other origin', async () => {
    const { fetcher, calls } = mockFetch(() => new Response(new Uint8Array([1, 2])))
    const client = api(fetcher)
    await expect(client.fetchBytes('https://cdn.jsdelivr.net/font.ttf')).rejects.toThrow(
      /not the app origin/
    )
    expect(calls).toHaveLength(0)
    const bytes = await client.fetchBytes('/api/design-engine/brand-fonts/x.ttf')
    expect(bytes).toEqual(new Uint8Array([1, 2]))
    expect(calls[0].url.href).toBe('https://app.example.com/api/design-engine/brand-fonts/x.ttf')
  })

  test('reads the token on every request so a rotated token is used', async () => {
    let token = 'first'
    const { fetcher, calls } = mockFetch(() => Response.json({ version: 1, updatedAt: '' }))
    const client = createStudioAPI({
      apiOrigin: 'https://app.example.com',
      templateId: 'tpl-1',
      token: () => token,
      fetch: fetcher
    })
    await client.saveTemplate({ document: emptyDocument, baseVersion: 0, kind: 'draft' })
    token = 'second'
    await client.saveTemplate({ document: emptyDocument, baseVersion: 1, kind: 'draft' })
    expect(calls.map((c) => new Headers(c.init.headers).get('authorization'))).toEqual([
      'Bearer first',
      'Bearer second'
    ])
  })
})
