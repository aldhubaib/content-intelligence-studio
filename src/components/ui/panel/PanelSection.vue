<script lang="ts">
import type { ClassValue } from 'tailwind-variants'
import type { VNode } from 'vue'

import type { ComponentUI } from '@/components/ui/types'
import type { PanelSectionTheme } from '@/theme/panel/section'

export interface PanelSectionProps {
  label: string
  open?: boolean
  defaultOpen?: boolean
  empty?: boolean
  /**
   * CI (FB-78, PATCHES H-72): the header row is a real toggle — a button with a
   * chevron, `aria-expanded` / `aria-controls`, click / Enter / Space. Sections
   * that do not opt in keep their static header.
   */
  collapsible?: boolean
  /** CI (FB-78): words shown beside the label while collapsed (the full text is the `title`). */
  collapsedSummary?: string
  class?: ClassValue
  ui?: ComponentUI<PanelSectionTheme>
}

export interface PanelSectionSlots {
  default(): VNode[]
  actions?(): VNode[]
  emptyAction?(): VNode[]
  /** CI (FB-78): content that stays visible under the header while the section is collapsed. */
  pinned?(): VNode[]
}
</script>

<script setup lang="ts">
import { tv } from 'tailwind-variants'
import { getCurrentInstance, useId } from 'vue'

import {
  PropertySectionActions,
  PropertySectionContent,
  PropertySectionEmptyAction,
  PropertySectionHeader,
  PropertySectionRoot,
  PropertySectionTitle
} from '@open-pencil/vue'

import theme from '@/theme/panel/section'

const {
  label,
  open,
  defaultOpen = true,
  empty = false,
  collapsible = false,
  collapsedSummary,
  class: className,
  ui
} = defineProps<PanelSectionProps>()
const vnodeProps = getCurrentInstance()?.vnode.props
const controlled = vnodeProps ? Object.hasOwn(vnodeProps, 'open') : false
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const slots = defineSlots<PanelSectionSlots>()

const styles = tv(theme)({ collapsible })
// CI (FB-78): `aria-controls` of the header button → the section body.
const bodyId = useId()
</script>

<template>
  <PropertySectionRoot
    as="section"
    v-bind="controlled ? { open } : {}"
    :default-open="defaultOpen"
    :empty="empty"
    :aria-label="label"
    :class="styles.root({ class: [ui?.root, className] })"
    @update:open="emit('update:open', $event)"
  >
    <template #default="{ open: isOpen, actions }">
      <PropertySectionHeader :class="styles.header({ class: ui?.header })">
        <!-- CI (FB-78): a collapsible section's title is a heading holding the toggle button (the
             disclosure pattern); the actions slot sits beside it and never toggles. -->
        <PropertySectionTitle
          v-if="collapsible"
          role="heading"
          aria-level="3"
          :class="styles.title({ class: ui?.title })"
        >
          <button
            type="button"
            :class="styles.toggle({ class: ui?.toggle })"
            :aria-expanded="isOpen ? 'true' : 'false'"
            :aria-controls="bodyId"
            data-slot="section-toggle"
            @click="actions.toggle()"
          >
            <icon-lucide-chevron-down
              v-if="isOpen"
              :class="styles.chevron({ class: ui?.chevron })"
              aria-hidden="true"
            />
            <icon-lucide-chevron-right
              v-else
              :class="styles.chevron({ class: ui?.chevron })"
              aria-hidden="true"
            />
            <span class="shrink-0">{{ label }}</span>
            <span
              v-if="!isOpen && collapsedSummary"
              :class="styles.summary({ class: ui?.summary })"
              :title="collapsedSummary"
              data-slot="section-summary"
              >· {{ collapsedSummary }}</span
            >
          </button>
        </PropertySectionTitle>
        <PropertySectionTitle v-else :class="styles.title({ class: ui?.title })">
          <span role="heading" aria-level="3">{{ label }}</span>
        </PropertySectionTitle>
        <PropertySectionActions
          v-if="slots.actions"
          :class="styles.actions({ class: ui?.actions })"
        >
          <slot name="actions" />
        </PropertySectionActions>
      </PropertySectionHeader>
      <slot name="pinned" />
      <PropertySectionContent :class="styles.body({ class: ui?.body })">
        <!-- CI (FB-78): Reka owns the content element's id; the toggle's `aria-controls` names this wrapper. -->
        <div v-if="collapsible" :id="bodyId" class="contents">
          <slot />
        </div>
        <slot v-else />
        <PropertySectionEmptyAction v-if="slots.emptyAction" as-child>
          <slot name="emptyAction" />
        </PropertySectionEmptyAction>
      </PropertySectionContent>
    </template>
  </PropertySectionRoot>
</template>
