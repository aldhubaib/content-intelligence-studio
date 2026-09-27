// CI: one seam for "insert a library component" in hosted mode (FB-58,
// ADR-058 §8 "As built — fix FB-58"); the twin of `save-override.ts`.
//
// Upstream reaches `createInstanceFromComponent` from three places — the
// canvas drop (`packages/vue/src/canvas/drop/use.ts`), the Assets panel's
// click / Enter / **Insert instance** (`AssetsPanel.vue`) and the catalog's
// `insertComponent` (`src/app/libraries/service.ts`). Instead of patching the
// three call sites, the store's `createInstanceFromComponent` asks this module
// first: a hosted session registers a handler that answers a brand-library
// component with a plain shape (`brand-shape.ts`) and `undefined` for anything
// else, in which case upstream runs unchanged. Standalone, nothing is
// registered and the standalone library flow is untouched.

export type HostedInsertHandler = (
  componentId: string,
  x?: number,
  y?: number,
  parentId?: string
) => string | null | undefined

let handler: HostedInsertHandler | null = null

/** Register (or clear with `null`) the hosted insert. Returns the previous handler. */
export function setHostedInsertHandler(
  next: HostedInsertHandler | null
): HostedInsertHandler | null {
  const previous = handler
  handler = next
  return previous
}

/** The hosted insert when one is registered; `null` in standalone mode. */
export function hostedInsertHandler(): HostedInsertHandler | null {
  return handler
}
