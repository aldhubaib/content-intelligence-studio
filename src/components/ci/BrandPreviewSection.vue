<!-- CI: **Preview with** for a selected `brand:*` layer — the gallery of that kind (Track E3d-b1, FB-44 §6). -->
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed } from 'vue'

import { useRetainedPopup, useSelectionState } from '@open-pencil/vue'

import type { StudioBrandAsset } from '@/app/ci/api'
import { bindingName, bindingOf, type Binding } from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import { PREVIEW_COPY } from '@/app/ci/preview'
import AppButton from '@/components/ui/button/AppButton.vue'
import { useMenuUI } from '@/components/ui/menu/menu'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const session = computed(() => hostedSession.value)
const overlay = computed(() => session.value?.preview.overlay ?? null)
const { selectedNode: node } = useSelectionState()
const { open, portalActive } = useRetainedPopup()
const menuCls = useMenuUI({ content: 'min-w-56' })

/** The selected layer's `brand:*` binding — the section shows only for one. */
const binding = computed<Extract<Binding, { kind: 'brand' }> | null>(() => {
  const n = node.value
  const vocabulary = session.value?.payload.value?.bindings.vocabulary
  if (!n || !vocabulary || n.type === 'TEXT') return null
  const b = bindingOf(n, vocabulary)
  return b?.kind === 'brand' ? b : null
})
const bindingWords = computed(() => (binding.value ? bindingName(binding.value) : ''))

/** Assets of the layer's kind, the default first. */
const assets = computed<StudioBrandAsset[]>(() => {
  const b = binding.value
  const all = overlay.value?.brandAssets.value ?? []
  if (!b) return []
  return all
    .filter((a) => a.kind === b.slotKind)
    .sort((x, y) => Number(y.isDefault) - Number(x.isDefault))
})
const emptyWords = computed(() => PREVIEW_COPY.brandEmpty[binding.value?.slotKind ?? ''] ?? '')

/** Re-read on every overlay sync so the row follows the choice. */
const current = computed(() => {
  void overlay.value?.tick.value
  const n = node.value
  return n && overlay.value ? overlay.value.brandAssetFor(n.id) : null
})
const chosen = computed(() => {
  void overlay.value?.tick.value
  const n = node.value
  return n ? (overlay.value?.brandChoices.value.get(n.id) ?? null) : null
})
const currentWords = computed(() => current.value?.name ?? emptyWords.value)
const helpWords = computed(() => PREVIEW_COPY.brandHelp(bindingWords.value))

function pick(assetId: unknown) {
  if (typeof assetId !== 'string') return
  const n = node.value
  if (!n || !overlay.value) return
  overlay.value.setBrandChoice(n.id, assetId)
  open.value = false
}

function reset() {
  const n = node.value
  if (!n || !overlay.value) return
  overlay.value.setBrandChoice(n.id, null)
}
</script>

<template>
  <PanelSection
    v-if="binding && overlay"
    :label="PREVIEW_COPY.brandSection"
    data-test-id="ci-brand-preview"
  >
    <div class="flex flex-col gap-1.5 px-2 pb-1">
      <p
        v-if="assets.length === 0"
        class="text-[11px] text-muted"
        role="status"
        data-test-id="ci-brand-preview-empty"
      >
        {{ emptyWords }}
      </p>
      <template v-else>
        <div class="flex items-center gap-1.5">
          <DropdownMenuRoot v-model:open="open">
            <DropdownMenuTrigger as-child>
              <AppButton
                size="xs"
                variant="soft"
                class="min-w-0 flex-1 justify-between"
                data-test-id="ci-brand-preview-trigger"
                :data-asset="current?.id ?? ''"
                :aria-label="`${PREVIEW_COPY.brandSection}: ${currentWords}`"
              >
                <span class="truncate">{{ currentWords }}</span>
                <span
                  v-if="current?.isDefault && !chosen"
                  class="ml-1 shrink-0 rounded-sm border border-border px-1 py-px text-[10px] text-muted uppercase"
                  data-test-id="ci-brand-preview-default"
                  >{{ PREVIEW_COPY.brandDefault }}</span
                >
                <template #trailing><icon-lucide-chevron-down class="size-3" /></template>
              </AppButton>
            </DropdownMenuTrigger>
            <DropdownMenuPortal v-if="portalActive">
              <DropdownMenuContent align="start" :side-offset="4" :class="menuCls.content">
                <DropdownMenuRadioGroup :model-value="current?.id ?? ''" @update:model-value="pick">
                  <DropdownMenuRadioItem
                    v-for="asset in assets"
                    :key="asset.id"
                    :value="asset.id"
                    :class="menuCls.item"
                    :data-test-id="`ci-brand-preview-asset-${asset.id}`"
                  >
                    <span class="flex-1 truncate">{{ asset.name }}</span>
                    <span
                      v-if="asset.isDefault"
                      class="shrink-0 rounded-sm border border-border px-1 py-px text-[10px] text-muted uppercase"
                      >{{ PREVIEW_COPY.brandDefault }}</span
                    >
                    <icon-lucide-check
                      v-if="current?.id === asset.id"
                      class="size-3 shrink-0"
                      aria-hidden="true"
                    />
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
                <DropdownMenuItem
                  v-if="chosen"
                  :class="menuCls.item"
                  data-test-id="ci-brand-preview-reset"
                  @select="reset()"
                >
                  <span class="flex-1">{{ PREVIEW_COPY.brandReset }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </div>
        <p class="text-[10px] leading-snug text-muted">{{ helpWords }}</p>
      </template>
    </div>
  </PanelSection>
</template>
