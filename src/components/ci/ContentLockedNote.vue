<!-- CI: Track E3d-c — the hint under a selected `content:*` text layer in DESIGN mode: the text is the post's.
     Track FB-69 (H-68): the same section over a `brand:display-name` / `brand:handle` layer — the text is the brand kit's. -->
<script setup lang="ts">
import { computed } from 'vue'

import { useSelectionState } from '@open-pencil/vue'

import { bindingName, bindingOf } from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import { PREVIEW_COPY } from '@/app/ci/preview'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const session = computed(() => hostedSession.value)
const { selectedNode: node } = useSelectionState()

/** The selected layer's locked binding while the session locks content text: the post's `content:<text>` or the kit's `brand:<text>`. */
const locked = computed<{ name: string; kind: 'content' | 'brand-text' } | null>(() => {
  const s = session.value
  const n = node.value
  const vocabulary = s?.payload.value?.bindings.vocabulary
  if (!s || !n || !vocabulary || !s.isDesign || n.type !== 'TEXT') return null
  const b = bindingOf(n, vocabulary)
  if (b?.kind === 'brand-text') return { name: bindingName(b), kind: 'brand-text' }
  return b?.kind === 'content' && b.slot !== 'image'
    ? { name: bindingName(b), kind: 'content' }
    : null
})
const label = computed(() =>
  locked.value?.kind === 'brand-text' ? PREVIEW_COPY.brandFixed : PREVIEW_COPY.designFixed
)
const words = computed(() =>
  locked.value?.kind === 'brand-text' ? PREVIEW_COPY.brandLockedHint : PREVIEW_COPY.designLockedHint
)
</script>

<template>
  <PanelSection v-if="locked" :label="label" data-test-id="ci-content-locked">
    <p
      class="px-2 pb-2 text-[11px] leading-snug text-muted"
      role="note"
      :data-binding="locked.name"
      :data-kind="locked.kind"
    >
      {{ words }}
    </p>
  </PanelSection>
</template>
