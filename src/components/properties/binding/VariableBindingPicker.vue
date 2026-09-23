<script lang="ts">
import type { BindingFieldUI } from '@/components/ui/binding'

export interface VariableBindingPickerProps {
  triggerLabel: string
  searchPlaceholder: string
  emptyLabel: string
  detachLabel: string
  createLabel?: string
  createNamePlaceholder?: string
  createSubmitLabel?: string
  createDefaultName?: string
  disabled?: boolean
  derived?: boolean
  ui?: BindingFieldUI
}
</script>

<script setup lang="ts">
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxTrigger,
  ComboboxViewport
} from 'reka-ui'
import { computed, nextTick, ref, watch } from 'vue'

import { BindableValuePicker, useBindableValue, useRetainedPopup } from '@open-pencil/vue'

import { brandSwatches } from '@/app/ci/document'
import { isHosted } from '@/app/ci/hosted'
import { BindingTrigger, useBindingFieldUI } from '@/components/ui/binding'
import AppButton from '@/components/ui/button/AppButton.vue'
import Tip from '@/components/ui/overlay/Tip.vue'

const {
  triggerLabel,
  searchPlaceholder,
  emptyLabel,
  detachLabel,
  createLabel,
  createNamePlaceholder = 'Variable name',
  createSubmitLabel = 'Create',
  createDefaultName = '',
  disabled = false,
  derived = false,
  ui
} = defineProps<VariableBindingPickerProps>()

const binding = useBindableValue<unknown>()
const { portalActive } = useRetainedPopup(binding.open)
// CI: the two brand colours as a swatch row above the variable list (Track E3d-a, FB-44 §4).
const hosted = isHosted()
const swatches = computed(() => (hosted ? brandSwatches(binding.variables.value) : []))
function bindSwatch(variableId: string) {
  binding.actions.bind(variableId)
  binding.actions.closePicker()
}
const creating = ref(false)
const createName = ref('')
const createInput = ref<HTMLInputElement | null>(null)
const canCreate = computed(() => createName.value.trim().length > 0)
const styles = computed(() =>
  useBindingFieldUI(
    {
      state: binding.state.value,
      open: binding.open.value,
      disabled,
      derived
    },
    ui
  )
)
function updateSearch(value: unknown) {
  if (typeof value === 'string') binding.actions.setSearchTerm(value)
}

function startCreate() {
  creating.value = true
  createName.value = createDefaultName
  void nextTick(() => {
    createInput.value?.focus()
    createInput.value?.select()
  })
}

function submitCreate() {
  const name = createName.value.trim()
  if (!name) return
  binding.actions.create(name)
}

function detach() {
  binding.actions.unbind()
  binding.actions.closePicker()
}

watch(binding.open, (open) => {
  if (open) return
  creating.value = false
  binding.actions.setSearchTerm('')
})

defineOptions({ inheritAttrs: false })
</script>

<template>
  <BindableValuePicker v-slot="picker">
    <ComboboxAnchor class="inline-flex shrink-0 items-center" data-slot="anchor">
      <Tip :label="triggerLabel">
        <ComboboxTrigger as-child>
          <BindingTrigger
            :label="triggerLabel"
            :state="picker.state"
            :open="picker.open"
            :disabled="disabled"
            :derived="derived"
            :ui="ui"
          />
        </ComboboxTrigger>
      </Tip>
    </ComboboxAnchor>

    <ComboboxPortal v-if="portalActive">
      <ComboboxContent
        v-if="picker.open"
        position="popper"
        side="bottom"
        align="end"
        :side-offset="8"
        :collision-padding="8"
        :class="styles.pickerContent"
        data-slot="content"
      >
        <ComboboxInput
          :model-value="picker.searchTerm"
          :placeholder="searchPlaceholder"
          :class="styles.pickerSearch"
          autocomplete="off"
          autocorrect="off"
          autocapitalize="off"
          :spellcheck="false"
          data-slot="search"
          @update:model-value="updateSearch"
        />
        <div
          v-if="swatches.length > 0"
          class="flex items-center gap-2 border-b border-border px-2 py-1.5"
          data-test-id="ci-brand-swatches"
          data-slot="brand"
        >
          <span class="text-[10px] text-muted">Brand</span>
          <Tip v-for="swatch in swatches" :key="swatch.variableId" :label="swatch.name">
            <button
              type="button"
              class="size-5 rounded border border-border focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              :class="picker.variable?.id === swatch.variableId ? 'ring-2 ring-accent' : ''"
              :style="{ backgroundColor: swatch.css }"
              :aria-label="`Use ${swatch.name}`"
              :aria-pressed="picker.variable?.id === swatch.variableId"
              :data-test-id="`ci-brand-swatch-${swatch.key}`"
              @click="bindSwatch(swatch.variableId)"
            />
          </Tip>
        </div>
        <ComboboxViewport :class="styles.pickerViewport" data-slot="viewport">
          <div v-if="picker.variables.length === 0" :class="styles.pickerEmpty" data-slot="empty">
            {{ emptyLabel }}
          </div>
          <ComboboxItem
            v-for="variable in picker.variables"
            :key="variable.id"
            :value="variable"
            :text-value="variable.name"
            :class="styles.pickerItem"
            data-slot="item"
          >
            <icon-lucide-diamond :class="styles.pickerItemIcon" data-slot="itemIcon" />
            <span :class="styles.pickerItemLabel" data-slot="itemLabel">{{ variable.name }}</span>
            <ComboboxItemIndicator :class="styles.pickerItemIndicator" data-slot="itemIndicator">
              <icon-lucide-check class="size-3" />
            </ComboboxItemIndicator>
          </ComboboxItem>
        </ComboboxViewport>

        <div :class="styles.pickerFooter" data-slot="footer">
          <AppButton
            v-if="picker.state !== 'unbound'"
            size="xs"
            class="w-full justify-start"
            data-slot="action"
            @click="detach"
          >
            <template #leading><icon-lucide-unlink class="size-3" /></template>
            {{ detachLabel }}
          </AppButton>

          <form
            v-if="creating"
            :class="styles.createForm"
            data-slot="createForm"
            @submit.prevent="submitCreate"
            @keydown.esc.prevent.stop="creating = false"
          >
            <input
              ref="createInput"
              v-model="createName"
              :placeholder="createNamePlaceholder"
              :class="styles.createInput"
              data-slot="createInput"
            />
            <AppButton
              size="xs"
              variant="soft"
              :disabled="!canCreate"
              data-slot="createSubmit"
              type="submit"
            >
              {{ createSubmitLabel }}
            </AppButton>
          </form>
          <AppButton
            v-else-if="createLabel"
            size="xs"
            class="w-full justify-start"
            data-slot="action"
            @click="startCreate"
          >
            <template #leading><icon-lucide-plus class="size-3" /></template>
            <span class="min-w-0 flex-1 truncate">{{ createLabel }}</span>
          </AppButton>
        </div>
      </ComboboxContent>
    </ComboboxPortal>
  </BindableValuePicker>
</template>
