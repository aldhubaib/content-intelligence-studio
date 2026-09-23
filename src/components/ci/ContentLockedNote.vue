<!-- CI: Track E3d-c — the hint under a selected `content:*` text layer in DESIGN mode: the text is the post's. -->
<script setup lang="ts">
import { computed } from 'vue'

import { useSelectionState } from '@open-pencil/vue'

import { bindingName, bindingOf } from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import { PREVIEW_COPY } from '@/app/ci/preview'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const session = computed(() => hostedSession.value)
const { selectedNode: node } = useSelectionState()

/** The selected layer's `content:<text slot>` binding while the session locks content text. */
const bindingWords = computed(() => {
  const s = session.value
  const n = node.value
  const vocabulary = s?.payload.value?.bindings.vocabulary
  if (!s || !n || !vocabulary || !s.isDesign || n.type !== 'TEXT') return null
  const b = bindingOf(n, vocabulary)
  return b?.kind === 'content' && b.slot !== 'image' ? bindingName(b) : null
})
</script>

<template>
  <PanelSection
    v-if="bindingWords"
    :label="PREVIEW_COPY.designFixed"
    data-test-id="ci-content-locked"
  >
    <p
      class="px-2 pb-2 text-[11px] leading-snug text-muted"
      role="note"
      :data-binding="bindingWords"
    >
      {{ PREVIEW_COPY.designLockedHint }}
    </p>
  </PanelSection>
</template>
