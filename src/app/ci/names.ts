// CI: the **Names** tab (Track FB-65, ADR-058 §8 "As built — Track FB-65").
//
// While naming layers the person needs the exact names the system fills:
// `content:*`, `brand:*` and the three frame roles. This module builds the
// tab's rows from the PAYLOAD — `bindings.vocabulary` (the closed lists) plus
// its `descriptions` map (what the app writes into each name) and the
// workspace's `brand.assets` — so the fork hard-codes no name and no
// sentence: when the app adds a slot the tab shows it on the next load, and a
// name the app did not describe renders its name alone, never hidden.
//
// Two actions per row, both here as pure functions the panel calls:
//   • copy — `navigator.clipboard.writeText`, falling back to a hidden
//     textarea + `execCommand('copy')` when the async API is unavailable or
//     refused (an iframe without the clipboard-write permission);
//   • rename selected — `store.updateNodeWithUndo(id, { name }, …)`, the very
//     call the Bindings panel's Shape control makes (`setBrandShape`): one
//     undo step, selection kept; several selected → the first one.

import type { EditorStore } from '@/app/editor/session'

import type { StudioBindingsVocabulary, StudioBrandAsset } from './api'
import { BRAND_PREFIX, CONTENT_PREFIX } from './bindings'
import { brandAssetBindingName, brandAssetDescription } from './brand-library'

export const NAMES_COPY = {
  /** The tab. */
  tab: 'Names',
  lead: 'Name a layer exactly like this and the system fills it.',
  groups: { content: 'Content', brand: 'Brand', frames: 'Frames' },
  columns: { name: 'Layer name', description: 'What the system writes into it' },
  copied: 'Copied',
  copyFailed: 'Could not copy — select the name and copy it yourself.',
  copyLabel: (name: string) => `Copy ${name}`,
  renameLabel: (name: string) => `Rename selected layer to ${name}`,
  renamed: (name: string) => `Renamed to ${name}`,
  renamedFirst: (name: string) => `Renamed the first selected layer to ${name}`,
  /** Undo label of a rename from the tab. */
  renameUndo: 'Rename layer'
} as const

/** How long the row shows **Copied** / the rename status, in ms. */
export const NAMES_STATUS_MS = 1500

/**
 * The one placeholder row under the brand kinds — its description comes from
 * the payload under this exact key (`bindingDescriptions()` in the app writes
 * it); the workspace's real assets are listed under it as sub-rows.
 */
export const BRAND_NAMED_ASSET_ROW = `${BRAND_PREFIX}<kind>:<asset name>`

export type NameRowKind = 'content' | 'brand' | 'brand-placeholder' | 'brand-asset' | 'role'

export interface NameRow {
  /** The exact layer name — what a click copies. */
  name: string
  /** What the system writes into it; null when the app did not describe the name. */
  description: string | null
  kind: NameRowKind
  /** Indented under the `brand:<kind>:<asset name>` placeholder. */
  sub: boolean
  /** False only for the placeholder — it is not a name a layer can carry. */
  renamable: boolean
}

export type NameGroupKey = 'content' | 'brand' | 'frames'

export interface NameGroup {
  key: NameGroupKey
  heading: string
  rows: NameRow[]
}

function describe(descriptions: Record<string, string> | undefined, name: string): string | null {
  const words = descriptions?.[name]
  return typeof words === 'string' && words.trim() ? words : null
}

function row(
  name: string,
  kind: NameRowKind,
  description: string | null,
  extra: Partial<Pick<NameRow, 'sub' | 'renamable'>> = {}
): NameRow {
  return { name, description, kind, sub: extra.sub ?? false, renamable: extra.renamable ?? true }
}

/**
 * The tab's three groups in the fixed order the app's vocabulary lists them:
 * Content = text slots → image slots → reserved; Brand = kinds → the
 * `brand:<kind>:<asset name>` placeholder → one sub-row per workspace asset in
 * gallery order; Frames = the roles.
 */
export function namesGroups(
  vocabulary: StudioBindingsVocabulary,
  assets: ReadonlyArray<StudioBrandAsset> = []
): NameGroup[] {
  const d = vocabulary.descriptions
  const content = [...vocabulary.contentText, ...vocabulary.contentImage, ...vocabulary.reserved]
    .map((slot) => `${CONTENT_PREFIX}${slot}`)
    .map((name) => row(name, 'content', describe(d, name)))
  const brand = vocabulary.brandKinds
    .map((kind) => `${BRAND_PREFIX}${kind}`)
    .map((name) => row(name, 'brand', describe(d, name)))
  brand.push(
    row(BRAND_NAMED_ASSET_ROW, 'brand-placeholder', describe(d, BRAND_NAMED_ASSET_ROW), {
      renamable: false
    })
  )
  for (const asset of assets) {
    if (!vocabulary.brandKinds.includes(asset.kind)) continue
    brand.push(
      row(brandAssetBindingName(asset), 'brand-asset', brandAssetDescription(asset), { sub: true })
    )
  }
  const frames = vocabulary.roles.map((role) => row(role, 'role', describe(d, role)))
  return [
    { key: 'content', heading: NAMES_COPY.groups.content, rows: content },
    { key: 'brand', heading: NAMES_COPY.groups.brand, rows: brand },
    { key: 'frames', heading: NAMES_COPY.groups.frames, rows: frames }
  ]
}

/** The pieces of the browser `copyText` touches — injectable so a unit test needs no DOM. */
export interface ClipboardEnv {
  writeText?: ((text: string) => Promise<void>) | null
  /** The hidden-textarea fallback; returns true when `execCommand('copy')` reported success. */
  legacyCopy?: (text: string) => boolean
}

/** The DOM fallback: a hidden, read-only textarea selected and copied with `execCommand`. */
export function legacyCopyViaTextarea(text: string): boolean {
  if (typeof document === 'undefined') return false
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-hidden', 'true')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.width = '1px'
  area.style.height = '1px'
  area.style.opacity = '0'
  area.style.pointerEvents = 'none'
  document.body.appendChild(area)
  const active = document.activeElement as HTMLElement | null
  area.focus()
  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch (error) {
    console.warn('[ci] execCommand copy failed', error)
    ok = false
  }
  area.remove()
  active?.focus()
  return ok
}

function browserClipboardEnv(): ClipboardEnv {
  const clipboard = typeof navigator === 'undefined' ? null : navigator.clipboard
  return {
    writeText: clipboard?.writeText ? (text) => clipboard.writeText(text) : null,
    legacyCopy: legacyCopyViaTextarea
  }
}

/**
 * Put `text` on the clipboard. The async API first; when it is missing or
 * rejects (permission, insecure context) the textarea fallback. True when
 * one of them reported success.
 */
export async function copyText(text: string, env: ClipboardEnv = browserClipboardEnv()) {
  if (env.writeText) {
    const wrote = await env.writeText(text).then(
      () => true,
      // Refused (permission, insecure context) → the textarea path below.
      () => false
    )
    if (wrote) return true
  }
  return env.legacyCopy ? env.legacyCopy(text) : false
}

export interface RenameSelectedResult {
  /** The renamed layer's id. */
  nodeId: string
  /** True when more than one layer was selected — the first one took the name. */
  several: boolean
}

/**
 * Give the first selected layer `name` through the store's undoable update —
 * the same call the Bindings panel's Shape control uses, so it is one undo
 * step (**Rename layer**) and the selection is kept. Null with nothing
 * selected or when the first selected id no longer resolves.
 */
export function renameSelectedLayer(store: EditorStore, name: string): RenameSelectedResult | null {
  const ids = [...store.state.selectedIds]
  if (ids.length === 0) return null
  const first = ids[0]
  const node = store.graph.getNode(first)
  if (!node) return null
  if (node.name !== name) {
    store.updateNodeWithUndo(first, { name }, NAMES_COPY.renameUndo)
    store.requestRender()
  }
  return { nodeId: first, several: ids.length > 1 }
}

/** The status sentence after a rename. */
export function renameStatusWords(result: RenameSelectedResult, name: string): string {
  return result.several ? NAMES_COPY.renamedFirst(name) : NAMES_COPY.renamed(name)
}
