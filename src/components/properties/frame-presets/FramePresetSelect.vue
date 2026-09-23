<script setup lang="ts">
import { computed } from 'vue'

import { useI18n, useSelectionState } from '@open-pencil/vue'

import { hostedSession } from '@/app/ci/boot'
import { contentFormatsCategory } from '@/app/ci/frame-presets'
import { isHosted } from '@/app/ci/hosted'
import { useEditorStore } from '@/app/editor/active-store'
import {
  findFrameResizePreset,
  FRAME_RESIZE_PRESET_CATEGORIES,
  FRAME_RESIZE_PRESETS,
  type FramePreset,
  type FramePresetCategory
} from '@/app/editor/frame-presets'
import PanelSection from '@/components/ui/panel/PanelSection.vue'
import AppGroupedSelect from '@/components/ui/select/AppGroupedSelect.vue'

const store = useEditorStore()
const { selectedNode } = useSelectionState()
const { panels } = useI18n()

// CI: hosted, the resize picker offers the app's **Content formats** only (Track E3d-a, FB-44 §1).
const hosted = isHosted()
const categories = computed<readonly FramePresetCategory[]>(() => {
  if (!hosted) return FRAME_RESIZE_PRESET_CATEGORIES
  const payload = hostedSession.value?.payload.value
  return [contentFormatsCategory(payload?.formats ?? [], payload?.format.id ?? null)]
})
const presets = computed<readonly FramePreset[]>(() =>
  hosted ? categories.value.flatMap((c) => c.presets) : FRAME_RESIZE_PRESETS
)

const selectedPreset = computed(() => {
  const node = selectedNode.value
  if (!node) return undefined
  if (!hosted) return findFrameResizePreset(node.width, node.height, node.name)
  return presets.value.find((p) => p.width === node.width && p.height === node.height)
})
const selectedPresetId = computed({
  get: () => selectedPreset.value?.id ?? 'custom',
  set: (id: string) => {
    const node = selectedNode.value
    const preset = presets.value.find((candidate) => candidate.id === id)
    if (node?.type === 'FRAME' && preset) store.resizeFrameToPreset(node.id, preset)
  }
})
const groups = computed(() =>
  categories.value.map((category) => ({
    label: category.label ?? panels.value[category.labelKey],
    items: category.presets.map((preset) => ({ value: preset.id, label: preset.name }))
  }))
)
const displayValue = computed(() => selectedPreset.value?.name ?? panels.value.framePresetCustom)
const selectUI = {
  content: 'max-h-80',
  viewport: 'max-h-80'
}
</script>

<template>
  <PanelSection :label="panels.frame">
    <AppGroupedSelect
      v-model="selectedPresetId"
      data-property="frame-preset"
      :aria-label="panels.framePreset"
      :groups="groups"
      :display-value="displayValue"
      :ui="selectUI"
    />
  </PanelSection>
</template>
