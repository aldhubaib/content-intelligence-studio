<!-- CI: hosted AI panel presets — four one-click prompts above the composer (ADR-061 §5, Track E4 Part C). -->
<script setup lang="ts">
import { computed } from 'vue'

import { useSelectionState } from '@open-pencil/vue'

import type { ChatSubmission } from '@/app/ai/chat/submission/types'
import {
  AI_PRESETS,
  buildPresetSubmission,
  primaryFrameOf,
  selectionNames,
  type AIPresetId
} from '@/app/ci/ai-presets'
import { hostedSession } from '@/app/ci/boot'

const { disabled = false } = defineProps<{ disabled?: boolean }>()

const emit = defineEmits<{
  submit: [submission: ChatSubmission]
}>()

const { editor, selectedIds } = useSelectionState()
const session = computed(() => hostedSession.value)

function run(id: AIPresetId): void {
  const s = session.value
  if (!s) return
  const store = editor
  const children = store.graph
    .getChildren(store.state.currentPageId)
    .map((n) => ({ type: n.type, width: n.width, height: n.height }))
  const selection = selectionNames(
    [...selectedIds.value].flatMap((nodeId) => {
      const node = store.graph.getNode(nodeId)
      return node ? [{ name: node.name }] : []
    })
  )
  const built = buildPresetSubmission(id, {
    brand: s.payload.value?.brand ?? null,
    slots: s.slots.value,
    requiredSlots: s.payload.value?.requiredSlots ?? [],
    frame: primaryFrameOf(children),
    selection
  })
  emit('submit', { ...built, images: [], nodes: [] })
}
</script>

<template>
  <div
    v-if="session"
    class="flex shrink-0 flex-wrap gap-1 border-t border-border px-3 pt-2 pb-1"
    role="group"
    aria-label="AI presets"
    data-test-id="ci-ai-presets"
  >
    <Tip v-for="preset in AI_PRESETS" :key="preset.id" :label="preset.description">
      <button
        type="button"
        class="inline-flex h-6 items-center border border-border bg-transparent px-2 text-[11px] text-surface transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
        :aria-label="`${preset.label}. ${preset.description}`"
        :disabled="disabled"
        :data-test-id="`ci-ai-preset-${preset.id}`"
        @click="run(preset.id)"
      >
        {{ preset.label }}
      </button>
    </Tip>
  </div>
</template>
