// CI: one seam for "Save" in hosted mode (ADR-058 §8, Track E3c Part B).
//
// Upstream routes every Save (⌘S, File → Save, the mobile HUD, the close
// dialog's "Save", the automation bridge) through the store's `saveFigFile`.
// Instead of patching five call sites, `createSaveActions` asks this module
// first: when a hosted session has registered a handler, Save and Save As
// both mean "Save version" against the Content Intelligence API and no `.fig`
// is ever produced. Standalone, nothing is registered and upstream runs.

export type HostedSaveHandler = () => Promise<boolean>

let handler: HostedSaveHandler | null = null

/** Register (or clear with `null`) the hosted Save. Returns the previous handler. */
export function setHostedSaveHandler(next: HostedSaveHandler | null): HostedSaveHandler | null {
  const previous = handler
  handler = next
  return previous
}

/** The hosted Save when one is registered; `null` in standalone mode. */
export function hostedSaveHandler(): HostedSaveHandler | null {
  return handler
}
