<script setup lang="ts">
import { CollapsibleContent, CollapsibleRoot, CollapsibleTrigger } from 'reka-ui'
import { computed } from 'vue'

import { useI18n } from '@open-pencil/vue'

import { hostedSession } from '@/app/ci/boot'
import { contentFormatsCategory } from '@/app/ci/frame-presets'
import { isHosted } from '@/app/ci/hosted'
import { useEditorStore } from '@/app/editor/active-store'
import { FRAME_PRESET_CATEGORIES, type FramePreset } from '@/app/editor/frame-presets'
import AddRoleFrameMenu from '@/components/ci/AddRoleFrameMenu.vue'
import { collapsibleContentMotion } from '@/theme/collapsible/collapsible'

const store = useEditorStore()
const { panels } = useI18n()

// CI: hosted, the one category is the app's **Content formats** (Track E3d-a, FB-44 §1);
// standalone, Figma's device categories as upstream ships them.
const hosted = isHosted()
const categories = computed(() => {
  if (!hosted) return FRAME_PRESET_CATEGORIES
  const payload = hostedSession.value?.payload.value
  return [contentFormatsCategory(payload?.formats ?? [], payload?.format.id ?? null)]
})
const graphTick = computed(() => hostedSession.value?.graphTick.value ?? 0)

function categoryLabel(category: (typeof categories.value)[number]): string {
  return category.label ?? panels.value[category.labelKey]
}

function createFrame(preset: FramePreset) {
  store.createFrameFromPreset(preset)
}
</script>

<template>
  <section :aria-label="panels.frame">
    <div class="flex h-10 items-center gap-2 border-b border-border px-3">
      <span role="heading" aria-level="2" class="flex-1 text-[11px] font-semibold text-surface">
        {{ panels.frame }}
      </span>
      <AddRoleFrameMenu v-if="hosted" :tick="graphTick" />
    </div>

    <CollapsibleRoot
      v-for="category in categories"
      :key="category.id"
      v-slot="{ open }"
      :default-open="category.id === 'phone' || category.id === 'content-formats'"
      class="border-b border-border"
    >
      <CollapsibleTrigger
        class="flex h-9 w-full items-center gap-1.5 px-3 text-left text-[11px] text-surface hover:bg-hover"
      >
        <icon-lucide-chevron-right
          class="size-3 shrink-0 transition-transform data-[open]:rotate-90"
          :data-open="open || undefined"
          aria-hidden="true"
        />
        <span class="min-w-0 flex-1 truncate">{{ categoryLabel(category) }}</span>
      </CollapsibleTrigger>

      <CollapsibleContent :class="collapsibleContentMotion">
        <!-- Padding stays inside the animated wrapper so it cannot snap. -->
        <div class="pb-1.5">
          <button
            v-for="preset in category.presets"
            :key="preset.id"
            type="button"
            :data-frame-preset="preset.id"
            class="flex h-7 w-full items-center gap-2 px-7 text-left text-[11px] text-surface hover:bg-hover"
            @click="createFrame(preset)"
          >
            <span class="min-w-0 flex-1 truncate">{{ preset.name }}</span>
            <span class="shrink-0 tabular-nums text-muted">
              {{ preset.width }} × {{ preset.height }}
            </span>
          </button>
        </div>
      </CollapsibleContent>
    </CollapsibleRoot>
  </section>
</template>
