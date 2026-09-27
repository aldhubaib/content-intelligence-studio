<!-- CI: **Shape** — Rectangle · Circle for a selected brand:* or content image layer (FB-58, ADR-058 §8 "As built — fix FB-58"). -->
<script setup lang="ts">
import { computed } from 'vue'

import { useSelectionState } from '@open-pencil/vue'

import { bindingName, bindingOf, DEFAULT_VOCABULARY } from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import {
  isBrandShapeType,
  setBrandShape,
  SHAPE_COPY,
  shapeControlApplies,
  type BrandShapeType
} from '@/app/ci/brand-shape'
import { useEditorStore } from '@/app/editor/active-store'
import SegmentedControl, {
  type SegmentedControlOption
} from '@/components/ui/select/SegmentedControl.vue'

export interface ShapeControlProps {
  /** Re-read the selected node when this changes (the session's graph tick). */
  tick?: number
}

const { tick = 0 } = defineProps<ShapeControlProps>()

const store = useEditorStore()
const { selectedNode } = useSelectionState()
const vocabulary = computed(
  () => hostedSession.value?.payload.value?.bindings.vocabulary ?? DEFAULT_VOCABULARY
)

/** The selected layer, re-read on every graph tick so a swap shows at once. */
const node = computed(() => {
  void tick
  const n = selectedNode.value
  return n ? (store.graph.getNode(n.id) ?? null) : null
})
const applies = computed(() => shapeControlApplies(node.value, vocabulary.value))
const shape = computed<BrandShapeType>(() =>
  node.value?.type === 'ELLIPSE' ? 'ELLIPSE' : 'RECTANGLE'
)
const layerWords = computed(() => {
  const n = node.value
  const b = n ? bindingOf(n, vocabulary.value) : null
  return b ? bindingName(b) : (n?.name ?? '')
})

const options: SegmentedControlOption[] = [
  { value: 'RECTANGLE', label: SHAPE_COPY.rectangle },
  { value: 'ELLIPSE', label: SHAPE_COPY.circle }
]
const ui = { root: 'w-40', item: 'px-1' }

function pick(value: string) {
  const n = node.value
  if (!n || !isBrandShapeType(value) || value === n.type) return
  setBrandShape(store, n.id, value, vocabulary.value)
}
</script>

<template>
  <div
    v-if="applies"
    class="flex items-center gap-2 px-2 pb-1.5"
    data-test-id="ci-shape-control"
    :data-shape="shape"
  >
    <span class="min-w-0 flex-1 truncate text-[11px] text-muted" :title="layerWords">
      {{ SHAPE_COPY.label }}
    </span>
    <SegmentedControl
      :model-value="shape"
      :options="options"
      :label="SHAPE_COPY.label"
      :ui="ui"
      @update:model-value="pick"
    />
  </div>
</template>
