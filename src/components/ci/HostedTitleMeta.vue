<script setup lang="ts">
// CI: the hosted title bar's facts next to the inline-editable name (FB-45):
// the Draft mark (FB-42), the read-only format line and OpenPencil-style save
// state driven by the session ("Saved · v2" / "Unsaved changes" / "Saving…").
import { computed } from 'vue'

import { hostedSession } from '@/app/ci/boot'
import { formatLine } from '@/app/ci/frame-presets'
import { isDraftName, saveStateWords } from '@/app/ci/session'
import { useEditorStore } from '@/app/editor/active-store'
import Tip from '@/components/ui/overlay/Tip.vue'

const store = useEditorStore()
const session = computed(() => hostedSession.value)
const draft = computed(() => isDraftName(store.state.documentName))
const format = computed(() => {
  const f = session.value?.payload.value?.format
  return f ? formatLine(f) : null
})
const saveState = computed(() => session.value?.saveState.value ?? { kind: 'loading' as const })
const saveWords = computed(() => saveStateWords(saveState.value))
</script>

<template>
  <div class="flex min-w-0 shrink items-center gap-2 text-[11px]" data-test-id="ci-title-meta">
    <span
      v-if="draft"
      class="shrink-0 rounded-sm border border-border px-1 py-px text-[10px] text-muted uppercase"
      data-test-id="ci-title-draft"
      >Draft</span
    >
    <!-- The format line steps aside in a narrow panel; the name and the save state stay. -->
    <Tip v-if="format" :label="format">
      <span
        class="hidden truncate text-muted @[300px]:inline"
        data-test-id="ci-title-format"
        :data-format="format"
        >{{ format }}</span
      >
    </Tip>
    <span
      class="shrink-0 truncate"
      :class="
        saveState.kind === 'error' || saveState.kind === 'conflict' ? 'text-danger' : 'text-muted'
      "
      role="status"
      aria-live="polite"
      data-test-id="ci-title-save-state"
      :data-kind="saveState.kind"
      >{{ saveWords }}</span
    >
  </div>
</template>
