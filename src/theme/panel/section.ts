// CI (FB-78, PATCHES H-72): the `collapsible` variant — a section that opts in gets a
// real header toggle (pointer cursor, chevron); every other inspector section keeps its look.
const panelSectionTheme = {
  slots: {
    root: 'border-b border-border px-3 pb-3 text-surface data-[disabled]:opacity-60',
    header: 'flex h-8 min-w-0 items-center gap-1.5',
    title:
      'min-w-0 flex-1 cursor-default truncate border-0 bg-transparent p-0 text-left text-[11px] font-semibold text-surface',
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
        title:
          'flex cursor-pointer items-center gap-1.5 rounded hover:text-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
      }
    }
  }
}

export type PanelSectionTheme = typeof panelSectionTheme
export default panelSectionTheme
