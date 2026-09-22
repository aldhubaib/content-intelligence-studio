// CI: the hosted Studio's AI panel (ADR-058 §8, Track E3c Part F).
//
// In hosted mode the provider is fixed: "Content Intelligence", the app's
// OpenAI-compatible proxy at `<app>/api/studio/ai` (`…/chat/completions`),
// authenticated with the same short-lived bearer the document API uses. The
// person never sees a provider list or a key field — the model list comes
// from the template payload (`ai.models`), the credential is the live token,
// and the panel is hidden altogether when the workspace switched AI off.
//
// Upstream's model settings, credential store and language-model factory are
// untouched in shape; each has one guarded call into this module.

import { computed, shallowRef } from 'vue'

import type { AIModelConnection, AIModelProfile, AIModelSettings } from '@/app/ai/models/types'
import type { FetchFunction } from '@/app/http/types'
import type {
  CredentialRef,
  CredentialStore,
  CredentialStoreAvailability,
  CredentialStatus
} from '@/app/settings/credentials/types'

import { hostedToken, isHosted } from './hosted'

/** One row of the payload's `ai.models`. */
export interface HostedAIModel {
  readonly id: string
  readonly label: string
}

export interface HostedAIConfig {
  readonly enabled: boolean
  readonly models: readonly HostedAIModel[]
}

/** The one connection the hosted Studio knows. */
export const HOSTED_AI_CONNECTION_ID = 'connection-content-intelligence'
/** Credential profile id of that connection; `providerCredentialRef('openai-compatible', …)` builds the ref. */
export const HOSTED_AI_CREDENTIAL_PROFILE = 'content-intelligence'
/** Display name the panel shows for the provider. */
export const HOSTED_AI_PROVIDER_NAME = 'Content Intelligence'
/** Path under the app origin the ai-sdk provider appends `/chat/completions` to. */
export const HOSTED_AI_BASE_PATH = '/api/studio/ai'

const DEFAULT_MAX_OUTPUT_TOKENS = 16_384

/** Profile id for a model id — stable, so chat history stays attached across reloads. */
export function hostedAIProfileId(modelId: string): AIModelProfile['id'] {
  const slug = modelId.toLowerCase().replaceAll(/[^a-z0-9._-]+/g, '-')
  return `model-ci-${slug}`
}

/** Base URL of the proxy for an app origin. */
export function hostedAIBaseURL(apiOrigin: string): string {
  return `${apiOrigin}${HOSTED_AI_BASE_PATH}`
}

/**
 * The pinned model settings: one `openai-compatible` connection to the proxy,
 * one profile per model (tools + vision — the proxy fronts a GPT-4-class chat
 * model), the first model on every role. Zero models (AI off, or before the
 * payload arrived) yields settings with no profile, which upstream reads as
 * "not configured".
 */
export function hostedAIModelSettings(
  apiOrigin: string,
  models: readonly HostedAIModel[]
): AIModelSettings {
  const connection: AIModelConnection = {
    id: HOSTED_AI_CONNECTION_ID,
    providerID: 'openai-compatible',
    customBaseURL: hostedAIBaseURL(apiOrigin),
    customAPIType: 'completions',
    credentialProfileId: HOSTED_AI_CREDENTIAL_PROFILE
  }
  const profiles: AIModelProfile[] = models.map((model) => ({
    id: hostedAIProfileId(model.id),
    name: `${HOSTED_AI_PROVIDER_NAME} · ${model.label}`,
    connectionId: connection.id,
    modelID: model.id,
    customModelID: model.id,
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    capabilities: ['tools', 'vision']
  }))
  const design = profiles[0]?.id ?? hostedAIProfileId('none')
  return {
    version: 1,
    connections: [connection],
    models: profiles,
    assignments: { design, review: 'design', fast: 'design', vision: 'design' }
  }
}

/** True for the hosted connection's own credential reference. */
export function isHostedAICredential(reference: CredentialRef): boolean {
  return (
    reference.integrationId === 'openai-compatible' &&
    reference.profileId === HOSTED_AI_CREDENTIAL_PROFILE &&
    reference.field === 'api-key'
  )
}

/**
 * A credential store whose only secret is the live bearer. Nothing is ever
 * written or persisted: the app mints and rotates the token (`host:token`), so
 * `read` answers with whatever is current and every other reference is
 * `missing`. `backend = 'memory'` keeps upstream's "remember in this browser"
 * copy off.
 */
export class HostedCredentialStore implements CredentialStore {
  readonly backend = 'memory' as const

  availability(): Promise<CredentialStoreAvailability> {
    return Promise.resolve('available')
  }

  status(reference: CredentialRef): Promise<CredentialStatus> {
    return Promise.resolve(
      isHostedAICredential(reference) && hostedToken.value ? 'configured' : 'missing'
    )
  }

  read(reference: CredentialRef): Promise<string | null> {
    return Promise.resolve(isHostedAICredential(reference) ? hostedToken.value || null : null)
  }

  write(): Promise<void> {
    return Promise.resolve()
  }

  remove(): Promise<void> {
    return Promise.resolve()
  }
}

// The engine's web-font manager swaps `globalThis.fetch` for a host-checked
// proxy while a provider operation is in flight; the AI proxy call must never
// go through it (same rule as `api.ts`).
const NATIVE_FETCH: typeof fetch | null =
  typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null

/**
 * The fetch the ai-sdk provider uses in hosted mode: stamps the *current*
 * bearer on every call, so a token rotated mid-conversation is picked up
 * without rebuilding the model, and never sends cookies.
 */
export function createHostedAIFetch(
  token: () => string,
  doFetch: FetchFunction = NATIVE_FETCH ?? fetch
): FetchFunction {
  return (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined)
    )
    headers.set('Authorization', `Bearer ${token()}`)
    return doFetch(input, { ...init, headers, credentials: 'omit', mode: 'cors' })
  }
}

/** The hosted AI fetch for this page, or `undefined` in standalone mode. */
export function hostedAIFetch(): FetchFunction | undefined {
  return isHosted() ? createHostedAIFetch(() => hostedToken.value) : undefined
}

const config = shallowRef<HostedAIConfig>({ enabled: false, models: [] })

/** What the payload said about AI for this template's workspace. */
export const hostedAIConfig = computed(() => config.value)

/** True when the AI tab / panel may be shown: hosted AND the workspace switch is on. */
export const hostedAIEnabled = computed(() => isHosted() && config.value.enabled)

/** Remember the payload's `ai` block; the session calls this after every load. */
export function setHostedAIConfig(next: HostedAIConfig): void {
  config.value = { enabled: next.enabled, models: [...next.models] }
}
