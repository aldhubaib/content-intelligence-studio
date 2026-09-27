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

/**
 * The selected layer's facts, re-read on every graph tick so a swap shows at
 * once. One fresh object per tick: the engine mutates a node in place, so a
 * computed that returned the node itself would hand back the same reference
 * after a type change and never wake its dependants.
 */
const view = computed(() => {
  void tick
  const selected = selectedNode.value
  const node = selected ? (store.graph.getNode(selected.id) ?? null) : null
  const binding = node ? bindingOf(node, vocabulary.value) : null
  const shape: BrandShapeType = node?.type === 'ELLIPSE' ? 'ELLIPSE' : 'RECTANGLE'
  return {
    node,
    applies: shapeControlApplies(node, vocabulary.value),
    shape,
    layerWords: binding ? bindingName(binding) : (node?.name ?? '')
  }
})
const applies = computed(() => view.value.applies)
const shape = computed(() => view.value.shape)
const layerWords = computed(() => view.value.layerWords)

const options: SegmentedControlOption[] = [
  { value: 'RECTANGLE', label: SHAPE_COPY.rectangle },
  { value: 'ELLIPSE', label: SHAPE_COPY.circle }
]
const ui = { root: 'w-36 shrink-0', item: 'px-1' }

function pick(value: string) {
  const n = view.value.node
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
