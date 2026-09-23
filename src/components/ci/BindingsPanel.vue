<!-- CI: Bindings side panel for the hosted Studio (Track E3d-a, FB-44 §2 / §3; replaces the E3c Slots panel). -->
<script setup lang="ts">
import { computed } from 'vue'

import {
  bindingsStatusWords,
  ROLE_LABELS,
  roleStatusWords,
  type BindingRef,
  type RoleReport
} from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import AddRoleFrameMenu from '@/components/ci/AddRoleFrameMenu.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import PanelItemRow from '@/components/ui/panel/PanelItemRow.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const session = computed(() => hostedSession.value)
const report = computed(() => session.value?.bindings.value ?? null)
const status = computed(() => session.value?.status.value ?? { kind: 'loading' as const })
const tick = computed(() => session.value?.graphTick.value ?? 0)

const roles = computed<RoleReport[]>(() => report.value?.roles ?? [])
const strays = computed<BindingRef[]>(() => report.value?.strayBindings ?? [])
const statusWords = computed(() => (report.value ? bindingsStatusWords(report.value.roles) : ''))
const usable = computed(() => report.value?.usable.single ?? false)
const carousel = computed(() => report.value?.usable.carousel ?? false)

/** Non-blocking shape problems (duplicates, wrong layer type) — warnings, listed once. */
const warnings = computed(() =>
  roles.value.flatMap((r) =>
    r.reasons.filter(
      (reason) =>
        reason.code === 'duplicate_binding' ||
        reason.code === 'text_on_shape' ||
        reason.code === 'image_on_text'
    )
  )
)

const statusLine = computed(() => {
  const s = status.value
  switch (s.kind) {
    case 'loading':
      return session.value?.isDesign ? 'Opening the design…' : 'Opening the template…'
    case 'saving':
      return s.saveKind === 'version' ? 'Saving version…' : 'Saving draft…'
    case 'conflict':
      return 'Someone saved a newer version.'
    case 'error':
      return s.message
    default:
      if (!session.value?.dirty.value) return 'All changes saved.'
      // Track E3d-c: a design has no autosave — Save version is the only save.
      return session.value.isDesign
        ? 'Unsaved changes — Save version (⌘S) keeps them as a new version.'
        : 'Unsaved changes — autosaves every 30 s.'
  }
})

function jumpTo(binding: BindingRef): void {
  session.value?.focusNode(binding.nodeId)
}

function jumpToFrame(role: RoleReport): void {
  if (role.frameId) session.value?.focusNode(role.frameId)
}

function bindingTitle(binding: BindingRef): string {
  const parts = [binding.name]
  if (binding.maxChars) parts.push(`≤ ${binding.maxChars} chars`)
  return parts.join(' · ')
}

function reasonWords(reason: RoleReport['reasons'][number]): string {
  switch (reason.code) {
    case 'duplicate_binding':
      return `${reason.name} is bound to ${reason.count} layers — the pipeline fills the first.`
    case 'text_on_shape':
      return `${reason.name} must be a text layer.`
    case 'image_on_text':
      return `${reason.name} must be an image or shape layer.`
    default:
      return ''
  }
}
</script>

<template>
  <PanelSection
    v-if="session"
    label="Bindings"
    data-test-id="ci-bindings-panel"
    class="shrink-0 border-b border-border"
  >
    <p class="px-2 pb-1 text-[11px] text-muted" data-test-id="ci-bindings-status" role="status">
      {{ statusLine }}
    </p>
    <div class="flex items-center gap-2 px-2 pb-1.5">
      <p
        class="min-w-0 flex-1 truncate text-[11px]"
        :class="usable ? 'text-surface' : 'text-warning-text'"
        data-test-id="ci-bindings-usable"
        :data-usable="usable ? 'true' : 'false'"
        :data-carousel="carousel ? 'true' : 'false'"
        role="status"
      >
        {{ statusWords }}
      </p>
      <AddRoleFrameMenu :tick="tick" />
    </div>
    <AppAlert
      v-for="reason in warnings"
      :key="`${reason.code}:${'name' in reason ? reason.name : ''}`"
      tone="warning"
      :heading="reasonWords(reason)"
      data-test-id="ci-bindings-warning"
      class="mx-2 mb-1"
    />
    <ul class="flex flex-col" aria-label="Role frames">
      <li v-for="role in roles" :key="role.role">
        <PanelItemRow
          :data-test-id="`ci-role-${role.role}`"
          :data-present="role.present ? 'true' : 'false'"
          :data-status="role.status"
        >
          <div class="flex min-w-0 flex-1 flex-col gap-0.5 py-0.5">
            <div class="flex items-center gap-2">
              <button
                type="button"
                class="truncate rounded px-1 text-[11px] text-surface hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default disabled:hover:bg-transparent"
                :disabled="!role.present"
                :aria-label="`Jump to the ${ROLE_LABELS[role.role]} frame`"
                :data-test-id="`ci-role-jump-${role.role}`"
                @click="jumpToFrame(role)"
              >
                {{ ROLE_LABELS[role.role] }}
              </button>
              <span class="flex-1" />
              <span
                class="truncate text-[10px]"
                :class="
                  !role.present
                    ? 'text-muted'
                    : role.status === 'ok'
                      ? 'text-surface'
                      : 'text-warning-text'
                "
                :data-test-id="`ci-role-words-${role.role}`"
              >
                {{ roleStatusWords(role).slice(ROLE_LABELS[role.role].length + 3) }}
              </span>
            </div>
            <div v-if="role.bindings.length > 0" class="flex flex-wrap gap-1 pl-1">
              <button
                v-for="binding in role.bindings"
                :key="binding.nodeId"
                type="button"
                class="max-w-44 truncate rounded bg-hover/60 px-1.5 py-0.5 text-[10px] text-surface hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                :aria-label="`Jump to ${bindingTitle(binding)}`"
                :data-test-id="`ci-binding-${role.role}-${binding.name}`"
                @click="jumpTo(binding)"
              >
                {{ bindingTitle(binding) }}
              </button>
            </div>
            <p v-else-if="role.present" class="pl-1 text-[10px] text-muted">
              No content: or brand: layers in this frame yet.
            </p>
          </div>
        </PanelItemRow>
      </li>
    </ul>
    <div v-if="strays.length > 0" class="px-2 pt-1 pb-1.5" data-test-id="ci-bindings-strays">
      <p class="text-[10px] text-muted">Outside every role frame — never rendered:</p>
      <div class="flex flex-wrap gap-1 pt-1">
        <button
          v-for="binding in strays"
          :key="binding.nodeId"
          type="button"
          class="max-w-44 truncate rounded bg-hover/60 px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          :aria-label="`Jump to ${bindingTitle(binding)}`"
          @click="jumpTo(binding)"
        >
          {{ bindingTitle(binding) }}
        </button>
      </div>
    </div>
  </PanelSection>
</template>
