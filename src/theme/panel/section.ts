// CI (FB-78, PATCHES H-72): the `collapsible` variant — a section that opts in gets a
// real header toggle (pointer cursor, chevron); every other inspector section keeps its look.
const panelSectionTheme = {
  slots: {
    root: 'border-b border-border px-3 pb-3 text-surface data-[disabled]:opacity-60',
    header: 'flex h-8 min-w-0 items-center gap-1.5',
    title:
      'min-w-0 flex-1 cursor-default truncate border-0 bg-transparent p-0 text-left text-[11px] font-semibold text-surface',
    /** CI (FB-78): the toggle button inside a collapsible section's heading (label + chevron + summary). */
    toggle:
      'flex h-full w-full min-w-0 cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent p-0 text-left text-[11px] font-semibold text-surface hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset',
    /** CI (FB-78): the chevron of a collapsible section's header. */
    chevron: 'size-3.5 shrink-0 text-muted',
    /** CI (FB-78): the verdict words beside the label while the section is collapsed. */
    summary: 'min-w-0 truncate font-normal text-muted',
    actions:
      'flex h-7 w-[26px] shrink-0 items-center justify-end gap-0.5 [&_[data-slot=icon-button]]:size-6 [&_[data-slot=icon-button]]:rounded',
    body: 'min-w-0 data-[state=closed]:hidden'
  },
  variants: {
    collapsible: {
      true: {
        title: 'flex h-7 cursor-pointer items-center'
      }
    }
  }
}

export type PanelSectionTheme = typeof panelSectionTheme
export default panelSectionTheme
