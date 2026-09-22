<!-- CI: Slots side panel for the hosted Studio (ADR-058 §8, Track E3c Part B). -->
<script setup lang="ts">
import { computed } from 'vue'

import { hostedSession } from '@/app/ci/boot'
import { SLOT_NAMES, type SlotBinding, type SlotName } from '@/app/ci/slots'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import PanelItemRow from '@/components/ui/panel/PanelItemRow.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const SLOT_LABELS: Record<SlotName, string> = {
  headline: 'Headline',
  body: 'Body',
  quote: 'Quote',
  attribution: 'Attribution',
  article_url: 'Article link',
  cover: 'Cover image'
}

const session = computed(() => hostedSession.value)
const report = computed(() => session.value?.slots.value ?? null)
const required = computed(() => new Set(session.value?.payload.value?.requiredSlots))
const status = computed(() => session.value?.status.value ?? { kind: 'loading' as const })

/** One row per vocabulary slot, in the fixed order; bound rows carry their node. */
const rows = computed(() =>
  SLOT_NAMES.map((slot) => {
    const bindings = (report.value?.bindings ?? []).filter((b) => b.slot === slot)
    return {
      slot,
      label: SLOT_LABELS[slot],
      required: required.value.has(slot),
      bindings,
      missing: required.value.has(slot) && bindings.length === 0
    }
  })
)

const missingRequired = computed(() => report.value?.missingRequired ?? [])
const duplicates = computed(() => report.value?.duplicates ?? [])

const statusLine = computed(() => {
  const s = status.value
  switch (s.kind) {
    case 'loading':
      return 'Opening the template…'
    case 'saving':
      return s.saveKind === 'version' ? 'Saving version…' : 'Saving draft…'
    case 'conflict':
      return 'Someone saved a newer version.'
    case 'error':
      return s.message
    default:
      return session.value?.dirty.value
        ? 'Unsaved changes — autosaves every 30 s.'
        : 'All changes saved.'
  }
})

function jumpTo(binding: SlotBinding): void {
  session.value?.focusNode(binding.nodeId)
}

function bindingTitle(binding: SlotBinding): string {
  const parts = [binding.nodeName]
  if (binding.maxChars) parts.push(`≤ ${binding.maxChars} chars`)
  return parts.join(' · ')
}
</script>

<template>
  <PanelSection
    v-if="session"
    label="Slots"
    data-test-id="ci-slots-panel"
    class="shrink-0 border-b border-border"
  >
    <p class="px-2 pb-1 text-[11px] text-muted" data-test-id="ci-slots-status" role="status">
      {{ statusLine }}
    </p>
    <AppAlert
      v-if="missingRequired.length > 0"
      tone="warning"
      heading="Required slots are missing"
      :description="`Add a layer named ${missingRequired.map((s) => `slot:${s}`).join(', ')} so the pipeline can fill it.`"
      data-test-id="ci-slots-missing"
      class="mx-2 mb-1"
    />
    <AppAlert
      v-if="duplicates.length > 0"
      tone="warning"
      heading="A slot is bound twice"
      :description="`${duplicates.map((s) => SLOT_LABELS[s]).join(', ')}: the pipeline fills the first layer only.`"
      data-test-id="ci-slots-duplicates"
      class="mx-2 mb-1"
    />
    <ul class="flex flex-col" aria-label="Slot bindings">
      <li v-for="row in rows" :key="row.slot">
        <PanelItemRow
          :data-test-id="`ci-slot-${row.slot}`"
          :data-missing="row.missing || undefined"
        >
          <div class="flex min-w-0 flex-1 items-center gap-2">
            <span class="truncate text-[11px] text-surface">{{ row.label }}</span>
            <span v-if="row.required" class="text-[10px] text-muted">required</span>
            <span class="flex-1" />
            <template v-if="row.bindings.length === 0">
              <span class="text-[10px]" :class="row.missing ? 'text-warning-text' : 'text-muted'">
                {{ row.missing ? 'Missing' : 'Not bound' }}
              </span>
            </template>
            <template v-else>
              <button
                v-for="binding in row.bindings"
                :key="binding.nodeId"
                type="button"
                class="max-w-40 truncate rounded px-1.5 py-0.5 text-[10px] text-surface hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                :aria-label="`Jump to ${bindingTitle(binding)}`"
                :data-test-id="`ci-slot-jump-${row.slot}`"
                @click="jumpTo(binding)"
              >
                {{ bindingTitle(binding) }}
                <span v-if="binding.typeMismatch" class="ml-1 text-muted">(wrong layer type)</span>
              </button>
            </template>
          </div>
        </PanelItemRow>
      </li>
    </ul>
  </PanelSection>
</template>
