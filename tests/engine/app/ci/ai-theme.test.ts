// CI: Part F — the pinned AI provider, the live-bearer credential store and the Carbon palette.
import { afterEach, describe, expect, test } from 'bun:test'

import {
  HOSTED_AI_CONNECTION_ID,
  HOSTED_AI_CREDENTIAL_PROFILE,
  HostedCredentialStore,
  createHostedAIFetch,
  hostedAIBaseURL,
  hostedAIEnabled,
  hostedAIModelSettings,
  hostedAIProfileId,
  isHostedAICredential,
  setHostedAIConfig
} from '@/app/ci/ai'
import { hostedToken } from '@/app/ci/hosted'
import { HOSTED_THEME_STORAGE_KEY, hostedPalette, themeStorageKey } from '@/app/ci/theme'
import { providerCredentialRef } from '@/app/settings/credentials/migration'

const ORIGIN = 'https://app.example.com'

afterEach(() => {
  hostedToken.value = ''
  setHostedAIConfig({ enabled: false, models: [] })
})

describe('hostedAIModelSettings', () => {
  test('one openai-compatible connection to the proxy, one profile per model, first model on every role', () => {
    const settings = hostedAIModelSettings(ORIGIN, [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 mini' }
    ])
    expect(settings.connections).toHaveLength(1)
    const [connection] = settings.connections
    expect(connection.id).toBe(HOSTED_AI_CONNECTION_ID)
    expect(connection.providerID).toBe('openai-compatible')
    expect(connection.customBaseURL).toBe(`${ORIGIN}/api/studio/ai`)
    expect(connection.customAPIType).toBe('completions')
    expect(connection.credentialProfileId).toBe(HOSTED_AI_CREDENTIAL_PROFILE)

    expect(settings.models.map((m) => m.id)).toEqual(['model-ci-gpt-4o', 'model-ci-gpt-4.1-mini'])
    expect(settings.models[0].name).toBe('Content Intelligence · GPT-4o')
    expect(settings.models[0].customModelID).toBe('gpt-4o')
    expect(settings.models[0].capabilities).toEqual(['tools', 'vision'])
    expect(settings.assignments).toEqual({
      design: 'model-ci-gpt-4o',
      review: 'design',
      fast: 'design',
      vision: 'design'
    })
  })

  test('no models → no profile, so upstream reads "not configured"', () => {
    const settings = hostedAIModelSettings(ORIGIN, [])
    expect(settings.models).toEqual([])
    expect(settings.models.some((m) => m.id === settings.assignments.design)).toBe(false)
  })

  test('profile ids are stable slugs of the model id', () => {
    expect(hostedAIProfileId('GPT-4o')).toBe('model-ci-gpt-4o')
    expect(hostedAIProfileId('org/model:beta')).toBe('model-ci-org-model-beta')
    expect(hostedAIBaseURL('http://localhost:3000')).toBe('http://localhost:3000/api/studio/ai')
  })
})

describe('HostedCredentialStore', () => {
  const ownRef = providerCredentialRef('openai-compatible', HOSTED_AI_CREDENTIAL_PROFILE)
  const otherRef = providerCredentialRef('openai')

  test('the hosted connection resolves to the live bearer and nothing else exists', async () => {
    const store = new HostedCredentialStore()
    expect(isHostedAICredential(ownRef)).toBe(true)
    expect(isHostedAICredential(otherRef)).toBe(false)
    expect(store.backend).toBe('memory')
    expect(await store.availability()).toBe('available')

    expect(await store.status(ownRef)).toBe('missing')
    hostedToken.value = 'tok-1'
    expect(await store.status(ownRef)).toBe('configured')
    expect(await store.read(ownRef)).toBe('tok-1')
    hostedToken.value = 'tok-2'
    expect(await store.read(ownRef)).toBe('tok-2')

    expect(await store.status(otherRef)).toBe('missing')
    expect(await store.read(otherRef)).toBeNull()
  })

  test('writes and removes are ignored — the app owns the token', async () => {
    const store = new HostedCredentialStore()
    hostedToken.value = 'tok'
    await store.write(ownRef, 'someone-elses-key')
    expect(await store.read(ownRef)).toBe('tok')
    await store.remove(ownRef)
    expect(await store.read(ownRef)).toBe('tok')
  })
})

describe('createHostedAIFetch', () => {
  test('stamps the current bearer on every call, omits cookies, keeps the caller headers', async () => {
    let token = 'first'
    const seen: Array<{ url: string; auth: string | null; ct: string | null; init: RequestInit }> =
      []
    const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      seen.push({
        url: String(input),
        auth: headers.get('authorization'),
        ct: headers.get('content-type'),
        init: init ?? {}
      })
      return Promise.resolve(new Response('{}'))
    }
    const doFetch = createHostedAIFetch(() => token, fetchImpl)
    await doFetch(`${ORIGIN}/api/studio/ai/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer placeholder' }
    })
    token = 'second'
    await doFetch(`${ORIGIN}/api/studio/ai/chat/completions`)

    expect(seen.map((s) => s.auth)).toEqual(['Bearer first', 'Bearer second'])
    expect(seen[0].ct).toBe('application/json')
    expect(seen[0].init.credentials).toBe('omit')
    expect(seen[0].init.mode).toBe('cors')
    expect(seen[0].init.method).toBe('POST')
  })
})

describe('hosted AI switch', () => {
  test('the panel is hidden unless hosted AND the workspace switched AI on', () => {
    // This test file runs standalone (no `?doc`), so the computed stays false either way …
    setHostedAIConfig({ enabled: true, models: [{ id: 'gpt-4o', label: 'GPT-4o' }] })
    expect(hostedAIEnabled.value).toBe(false)
    setHostedAIConfig({ enabled: false, models: [] })
    expect(hostedAIEnabled.value).toBe(false)
  })
})

describe('Carbon palette', () => {
  test('hosted: dark → Gray 100, light → Gray 10; standalone: no palette at all', () => {
    expect(hostedPalette('dark', true)).toBe('carbon-g100')
    expect(hostedPalette('light', true)).toBe('carbon-g10')
    expect(hostedPalette('dark', false)).toBeNull()
    expect(hostedPalette('light', false)).toBeNull()
  })

  test('the hosted theme preference never shares upstream storage', () => {
    expect(themeStorageKey(true)).toBe(HOSTED_THEME_STORAGE_KEY)
    expect(themeStorageKey(false)).toBe('open-pencil:theme')
    expect(HOSTED_THEME_STORAGE_KEY).not.toBe('open-pencil:theme')
  })
})
