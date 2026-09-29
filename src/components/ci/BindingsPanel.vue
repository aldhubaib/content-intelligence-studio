<!-- CI: Bindings side panel for the hosted Studio (Track E3d-a, FB-44 §2 / §3; replaces the E3c Slots panel).
     Track FB-61 (PATCHES H-67): the format-aware checklist — one row per contract role, the helper
     sentence, and one yellow line per role frame the format never renders.
     Track FB-69 (PATCHES H-68): the **Brand text** rows — brand:display-name / brand:handle as optional
     text bindings, present only when the app's vocabulary lists them.
     FB-78 (PATCHES H-72): the section is a real toggle — collapsed by default when Usable and every
     contract row is met, open when something is not met or nothing is bound yet, the person's toggle
     remembered per browser; open it is bounded to 45 % of the inspector column with its own scroll so
     the design inspector below always keeps at least half; the collapsed header carries the verdict;
     **Add role frame ▾** and the Shape row stay reachable while collapsed. -->
<script setup lang="ts">
import { useLocalStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'

import {
  BRAND_TEXT_COPY,
  bindingsStatusWords,
  brandTextRows,
  DEFAULT_VOCABULARY,
  ROLE_LABELS,
  ROLE_UNUSED_WORDS,
  roleStatusWords,
  type BindingRef,
  type RoleReport
} from '@/app/ci/bindings'
import {
  BINDINGS_OPEN_STORAGE_KEY,
  bindingsDefaultOpen,
  brandTextChipWords,
  parseStoredBindingsOpen,
  resolveBindingsOpen,
  serializeBindingsOpen
} from '@/app/ci/bindings-panel'
import { hostedSession } from '@/app/ci/boot'
import { contractChecklist, contractOf } from '@/app/ci/contract'
import AddRoleFrameMenu from '@/components/ci/AddRoleFrameMenu.vue'
import ShapeControl from '@/components/ci/ShapeControl.vue'
import AppCollapsible from '@/components/ui/collapsible/AppCollapsible.vue'
import AppAlert from '@/components/ui/feedback/AppAlert.vue'
import PanelItemRow from '@/components/ui/panel/PanelItemRow.vue'
import PanelSection from '@/components/ui/panel/PanelSection.vue'

const session = computed(() => hostedSession.value)
const report = computed(() => session.value?.bindings.value ?? null)
const status = computed(() => session.value?.status.value ?? { kind: 'loading' as const })
const tick = computed(() => session.value?.graphTick.value ?? 0)

// Track FB-61: the panel lists the CONTRACT's roles plus any present role frame the format never renders.
const contract = computed(() =>
  contractOf(session.value?.payload.value?.format ?? null, session.value?.payload.value?.contract)
)
const checklist = computed(() =>
  report.value
    ? contractChecklist(
        {
          roles: contract.value.roles,
          rows: session.value?.payload.value?.contract?.rows
        },
        report.value
      )
    : []
)
const roles = computed<RoleReport[]>(() =>
  (report.value?.roles ?? []).filter((r) => r.inContract || r.present)
)
const unusedRoles = computed(() => report.value?.unusedRoles ?? [])
const strays = computed<BindingRef[]>(() => report.value?.strayBindings ?? [])
const statusWords = computed(() => (report.value ? bindingsStatusWords(report.value.roles) : ''))
const usable = computed(() => report.value?.usable.single ?? false)
const carousel = computed(() => report.value?.usable.carousel ?? false)
// Track FB-69: the kit's text names as optional bindings; an older app's vocabulary lists none → no rows.
const brandText = computed(() =>
  report.value
    ? brandTextRows(
        report.value,
        session.value?.payload.value?.bindings.vocabulary ?? DEFAULT_VOCABULARY
      )
    : []
)
// FB-78 (H-72): the Brand text block is its own inline disclosure, collapsed by default (this page
// only — the person's Bindings toggle is the one remembered); the collapsed row counts the names present.
const brandTextOpen = ref(false)
const brandTextSummary = computed(() => {
  const present = brandText.value.filter((row) => row.layers.length > 0).length
  return `${present} of ${brandText.value.length} added`
})
/** Every role's frame id, so a chip can name the frame that holds its layer. */
const allRoles = computed<RoleReport[]>(() => report.value?.roles ?? [])

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

// FB-78 (PATCHES H-72): the section's open state. A stored toggle wins (the Studio's own key, the
// same `useLocalStorage` idiom as the theme preference — nothing is written until the person
// toggles); otherwise the default is judged ONCE when the document has loaded (collapsed when
// Usable + every row met, open when something is not met or nothing is bound yet) and never flips
// under the person while they work.
const stored = useLocalStorage<string>(BINDINGS_OPEN_STORAGE_KEY, '', { writeDefaults: false })
const open = ref(true)
const openDecided = ref(false)
watch(
  () => [status.value.kind, report.value] as const,
  ([kind, current]) => {
    if (openDecided.value || kind === 'loading' || !current) return
    openDecided.value = true
    open.value = resolveBindingsOpen(
      parseStoredBindingsOpen(stored.value),
      bindingsDefaultOpen(current, checklist.value)
    )
  },
  { immediate: true }
)
function setOpen(next: boolean): void {
  open.value = next
  openDecided.value = true
  stored.value = serializeBindingsOpen(next)
}

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
  <!-- FB-78 (H-72): the section is bounded to 45 % of the inspector column — `max-h-[45%]` on the
       section, the body scrolls (`ui.body`) — so the design inspector below always keeps ≥ half. -->
  <PanelSection
    v-if="session"
    label="Bindings"
    collapsible
    :open="open"
    :collapsed-summary="statusWords"
    data-test-id="ci-bindings-panel"
    :data-open="open ? 'true' : 'false'"
    class="flex max-h-[45%] min-h-0 flex-col border-b border-border pb-0"
    :ui="{
      header: 'shrink-0',
      actions: 'w-auto',
      body: 'min-h-0 flex-1 overflow-y-auto pb-3 data-[state=closed]:hidden'
    }"
    @update:open="setOpen"
  >
    <template #actions>
      <AddRoleFrameMenu :tick="tick" />
    </template>
    <template #pinned>
      <!-- FB-58: Rectangle · Circle for the selected brand:* / content image layer — pinned under the
           header (FB-78) so the switch is reachable while the section is collapsed. -->
      <ShapeControl :tick="tick" />
    </template>
    <p class="px-2 pb-1 text-[11px] text-muted" data-test-id="ci-bindings-status" role="status">
      {{ statusLine }}
    </p>
    <p
      class="min-w-0 truncate px-2 pb-1.5 text-[11px]"
      :class="usable ? 'text-surface' : 'text-warning-text'"
      data-test-id="ci-bindings-usable"
      :data-usable="usable ? 'true' : 'false'"
      :data-carousel="carousel ? 'true' : 'false'"
      role="status"
    >
      {{ statusWords }}
    </p>
    <!-- Track FB-61: the format's contract as a checklist, then the one helper sentence. -->
    <ul
      v-if="checklist.length > 0"
      class="flex flex-col gap-0.5 px-2 pb-1"
      aria-label="What this format needs"
      data-test-id="ci-contract-checklist"
    >
      <li
        v-for="row in checklist"
        :key="row.role"
        class="flex items-baseline gap-2 text-[10px]"
        :data-test-id="`ci-contract-${row.role}`"
        :data-met="row.met ? 'true' : 'false'"
        :title="row.label"
      >
        <span
          class="w-3 shrink-0 text-center"
          :class="
            row.met
              ? 'text-surface'
              : row.requirement === 'optional'
                ? 'text-muted'
                : 'text-warning-text'
          "
          aria-hidden="true"
          >{{ row.met ? '✓' : row.requirement === 'optional' ? '–' : '!' }}</span
        >
        <span class="min-w-0 flex-1 truncate text-surface">{{ row.label }}</span>
        <span
          class="shrink-0"
          :class="
            row.met
              ? 'text-surface'
              : row.requirement === 'optional'
                ? 'text-muted'
                : 'text-warning-text'
          "
          :data-test-id="`ci-contract-words-${row.role}`"
          >{{ row.words }}</span
        >
      </li>
    </ul>
    <p class="px-2 pb-1.5 text-[10px] text-muted" data-test-id="ci-contract-helper">
      {{ contract.helper }}
    </p>
    <AppAlert
      v-for="role in unusedRoles"
      :key="`unused:${role}`"
      tone="warning"
      :heading="`${ROLE_LABELS[role]} — ${ROLE_UNUSED_WORDS}`"
      :data-test-id="`ci-contract-unused-${role}`"
      class="mx-2 mb-1"
    />
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
                  !role.present || !role.inContract
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
    <!-- Track FB-69: the brand kit's text names — optional, never part of the usable verdict.
         FB-78 (H-72): its own inline disclosure, collapsed by default; one chip PER LAYER named by
         the role frame that holds it (a layer outside every role frame reads its layer name); the
         count word is the row's sr-only summary only. -->
    <AppCollapsible
      v-if="brandText.length > 0"
      v-model:open="brandTextOpen"
      :label="BRAND_TEXT_COPY.heading"
      class="px-2 pt-1 pb-1"
      :ui="{ trigger: 'h-6 text-[11px] font-semibold', content: 'pt-0.5' }"
      data-test-id="ci-brand-text"
      :data-open="brandTextOpen ? 'true' : 'false'"
    >
      <template #actions>
        <span class="text-[10px] text-muted" data-test-id="ci-brand-text-count">
          {{ brandTextSummary }}
        </span>
      </template>
      <p class="text-[10px] text-muted">{{ BRAND_TEXT_COPY.lead }}</p>
      <ul class="flex flex-col gap-0.5 pt-1" :aria-label="BRAND_TEXT_COPY.heading">
        <li
          v-for="row in brandText"
          :key="row.slot"
          class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[10px]"
          :data-test-id="`ci-brand-text-${row.slot}`"
          :data-present="row.layers.length > 0 ? 'true' : 'false'"
          :title="row.description ?? row.name"
        >
          <code class="font-mono text-[11px] text-surface">{{ row.name }}</code>
          <span class="flex-1" />
          <template v-if="row.layers.length > 0">
            <span class="sr-only">{{ BRAND_TEXT_COPY.present(row.layers.length) }}</span>
            <button
              v-for="binding in row.layers"
              :key="binding.nodeId"
              type="button"
              class="max-w-44 truncate rounded bg-hover/60 px-1.5 py-0.5 text-[10px] text-surface hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              :aria-label="`Jump to ${row.name} in ${brandTextChipWords(binding, allRoles)}`"
              :title="binding.nodeName"
              :data-test-id="`ci-brand-text-jump-${row.slot}`"
              @click="jumpTo(binding)"
            >
              {{ brandTextChipWords(binding, allRoles) }}
            </button>
          </template>
          <span v-else class="text-muted" :data-test-id="`ci-brand-text-words-${row.slot}`">
            {{ BRAND_TEXT_COPY.notAdded }}
          </span>
          <span v-if="row.description" class="basis-full text-muted">{{ row.description }}</span>
        </li>
      </ul>
    </AppCollapsible>
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
