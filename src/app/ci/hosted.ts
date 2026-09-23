// CI: hosted-mode configuration (ADR-058 §8, Track E3c Part B).
//
// The Content Intelligence app embeds the Studio as an iframe and writes four
// URL parameters: `doc` (template id), `ws` (workspace slug), `token` (short
// lived bearer minted by the app) and `api` (the app origin every request
// goes to). When `doc` is absent the Studio behaves exactly like upstream
// OpenPencil, so `bun run dev` keeps working for us.

import { shallowRef } from 'vue'

import { IS_BROWSER } from '@open-pencil/core/constants'

export interface HostedConfig {
  /** Template id the Studio edits — the only document this session may load or save. */
  readonly templateId: string
  /** Workspace slug, informational (the token already scopes the API). */
  readonly workspaceSlug: string
  /** App origin, e.g. `https://content-intelligence.up.railway.app`. Always `https:` in production. */
  readonly apiOrigin: string
  /** The initial bearer; refreshed through `host:token`. */
  readonly initialToken: string
  /** Track E3d-b1: `?preview=<candidate id>` preselects that Approved candidate in **Preview with ▾**. */
  readonly previewCandidateId?: string | null
}

const UUID_LIKE = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/

/**
 * Parse `?doc=&ws=&token=&api=` into a config, or `null` when the Studio is
 * standalone. A partially present set is treated as a configuration error
 * (thrown) rather than silently falling back to standalone: the person would
 * otherwise see an empty editor with no clue why.
 */
export function parseHostedConfig(search: string): HostedConfig | null {
  const params = new URLSearchParams(search)
  const doc = params.get('doc')
  if (doc === null) return null
  const ws = params.get('ws') ?? ''
  const token = params.get('token') ?? ''
  const api = params.get('api') ?? ''
  if (!UUID_LIKE.test(doc)) throw new Error('Hosted Studio: `doc` is not a valid template id')
  if (!token) throw new Error('Hosted Studio: `token` is missing')
  let origin: string
  try {
    const url = new URL(api)
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new Error('Hosted Studio: `api` must be an http(s) origin')
    origin = url.origin
  } catch {
    throw new Error('Hosted Studio: `api` is not a valid origin')
  }
  const preview = params.get('preview')
  return {
    templateId: doc,
    workspaceSlug: ws,
    apiOrigin: origin,
    initialToken: token,
    previewCandidateId: preview && UUID_LIKE.test(preview) ? preview : null
  }
}

/**
 * Read once at module load from `window.location`. `null` in standalone mode,
 * in tests, and on the server. A parse error is remembered so the boot path
 * can surface it in words instead of throwing during module evaluation.
 */
function readFromLocation(): { config: HostedConfig | null; error: string | null } {
  if (!IS_BROWSER) return { config: null, error: null }
  try {
    return { config: parseHostedConfig(window.location.search), error: null }
  } catch (error) {
    return { config: null, error: error instanceof Error ? error.message : String(error) }
  }
}

const initial = readFromLocation()

/** The hosted configuration for this page, or `null` (standalone). */
export const hostedConfig: HostedConfig | null = initial.config

/** Set when the URL carried `doc` but the rest was unusable. */
export const hostedConfigError: string | null = initial.error

/** True when this page is embedded by the Content Intelligence app. */
export function isHosted(): boolean {
  return hostedConfig !== null
}

/** The current bearer token; the host rotates it through `host:token`. */
export const hostedToken = shallowRef<string>(initial.config?.initialToken ?? '')

/**
 * Scrub the credential from the address bar as soon as the page has read it,
 * so a screenshot, a copied URL or the browser history never carries a token.
 * The router is not involved: hosted mode has one route.
 */
export function scrubTokenFromLocation(): void {
  if (!IS_BROWSER || !hostedConfig) return
  const url = new URL(window.location.href)
  if (!url.searchParams.has('token')) return
  url.searchParams.delete('token')
  window.history.replaceState(window.history.state, '', url)
}
