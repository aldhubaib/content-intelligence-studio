<!-- CI: **Preview with ▾** — an Approved Arabic candidate · Sample text · None (Track E3d-b1, FB-44 §6). -->
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuRoot,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed, ref } from 'vue'

import { useRetainedPopup } from '@open-pencil/vue'

import type { StudioPreviewCandidate } from '@/app/ci/api'
import { hostedSession } from '@/app/ci/boot'
import {
  PREVIEW_COPY,
  relativeTimeWords,
  selectionWords,
  type ContentPreviewSelection
} from '@/app/ci/preview'
import AppButton from '@/components/ui/button/AppButton.vue'
import { useMenuUI } from '@/components/ui/menu/menu'

const session = computed(() => hostedSession.value)
const overlay = computed(() => session.value?.preview.overlay ?? null)
const candidates = computed(() => session.value?.preview.candidates ?? null)

const { open, portalActive } = useRetainedPopup()
const menuCls = useMenuUI({ content: 'min-w-72 max-w-96' })

const selection = computed<ContentPreviewSelection>(
  () => overlay.value?.content.value ?? { kind: 'none' }
)
const words = computed(() => selectionWords(selection.value))
const accessibleName = computed(() => `${words.value} — ${PREVIEW_COPY.srOnly}`)
const state = computed(() => candidates.value?.state.value ?? { kind: 'idle' as const })
const now = ref(new Date())
interface CandidateRow {
  candidate: StudioPreviewCandidate
  title: string
  approved: string
}
const rows = computed<CandidateRow[]>(() =>
  (state.value.kind === 'ready' ? state.value.candidates : []).map((candidate) => ({
    candidate,
    title: candidate.title || candidate.id,
    approved: PREVIEW_COPY.approved(relativeTimeWords(candidate.approvedAt, now.value))
  }))
)
/** Radio value: a candidate id, 'sample' or 'none'. */
const radioValue = computed(() => {
  const s = selection.value
  return s.kind === 'candidate' ? s.candidate.id : s.kind
})
const dataSelection = computed(() => radioValue.value)

// The list is fetched the first time the menu opens and cached for the session.
function onOpenChange(next: boolean) {
  if (!next) return
  now.value = new Date()
  void candidates.value?.load()
}

function pick(value: unknown) {
  if (typeof value !== 'string') return
  const o = overlay.value
  if (!o) return
  if (value === 'none') o.setContent({ kind: 'none' })
  else if (value === 'sample') o.setContent({ kind: 'sample' })
  else {
    const row = rows.value.find((r) => r.candidate.id === value)
    if (row) o.setContent({ kind: 'candidate', candidate: row.candidate })
  }
  open.value = false
}

const refreshing = ref(false)
async function refresh() {
  if (!candidates.value) return
  refreshing.value = true
  try {
    const fresh = await candidates.value.load(true)
    // A candidate that left the list (un-approved) stops previewing.
    const s = selection.value
    if (s.kind === 'candidate' && !fresh.some((c) => c.id === s.candidate.id)) {
      overlay.value?.setContent({ kind: 'none' })
    }
  } finally {
    refreshing.value = false
  }
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open" @update:open="onOpenChange">
    <DropdownMenuTrigger as-child>
      <!-- The title row is the narrow left panel: the words show from 360 px, the eye
           always; the accessible name carries the words + "Preview content, not saved". -->
      <AppButton
        size="xs"
        variant="soft"
        class="shrink-0"
        :disabled="!overlay"
        data-test-id="ci-preview-menu"
        :data-selection="dataSelection"
        :data-active="selection.kind !== 'none' ? '' : undefined"
        :aria-label="accessibleName"
        :title="accessibleName"
      >
        <template #leading><icon-lucide-eye class="size-3" /></template>
        <span class="hidden max-w-40 truncate @[360px]:inline" dir="auto" aria-hidden="true">{{
          words
        }}</span>
        <template #trailing><icon-lucide-chevron-down class="size-3" /></template>
      </AppButton>
    </DropdownMenuTrigger>
    <DropdownMenuPortal v-if="portalActive">
      <DropdownMenuContent
        align="end"
        :side-offset="4"
        :class="menuCls.content"
        data-test-id="ci-preview-menu-content"
      >
        <DropdownMenuLabel class="px-2 py-1 text-[10px] tracking-wide text-muted uppercase">
          {{ PREVIEW_COPY.heading }}
        </DropdownMenuLabel>

        <DropdownMenuRadioGroup :model-value="radioValue" @update:model-value="pick">
          <!-- Loading · unavailable · empty rows are inert; the sample and None always work. -->
          <DropdownMenuItem
            v-if="state.kind === 'loading' || state.kind === 'idle'"
            :class="menuCls.item"
            disabled
            data-test-id="ci-preview-loading"
          >
            <span class="flex-1 text-muted">{{ PREVIEW_COPY.loading }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            v-else-if="state.kind === 'unavailable'"
            :class="menuCls.item"
            disabled
            data-test-id="ci-preview-unavailable"
          >
            <span class="flex-1 text-muted">{{ PREVIEW_COPY.unavailable }}</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            v-else-if="rows.length === 0"
            :class="[menuCls.item, 'whitespace-normal']"
            disabled
            data-test-id="ci-preview-empty"
          >
            <span class="flex-1 text-muted">{{ PREVIEW_COPY.empty }}</span>
          </DropdownMenuItem>
          <template v-else>
            <DropdownMenuRadioItem
              v-for="row in rows"
              :key="row.candidate.id"
              :value="row.candidate.id"
              :class="[menuCls.item, 'items-start']"
              :data-test-id="`ci-preview-candidate-${row.candidate.id}`"
            >
              <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                <span class="truncate" dir="auto" lang="ar">{{ row.title }}</span>
                <span class="flex items-center gap-1.5 text-[10px] text-muted">
                  <span
                    v-if="row.candidate.formatLabel"
                    class="rounded-sm border border-border px-1 py-px"
                    :data-format="row.candidate.format ?? undefined"
                    >{{ row.candidate.formatLabel }}</span
                  >
                  <span>{{ row.approved }}</span>
                </span>
              </span>
              <icon-lucide-check
                v-if="radioValue === row.candidate.id"
                class="mt-0.5 size-3 shrink-0"
                aria-hidden="true"
              />
            </DropdownMenuRadioItem>
          </template>

          <DropdownMenuSeparator :class="menuCls.separator" />
          <DropdownMenuRadioItem
            value="sample"
            :class="menuCls.item"
            data-test-id="ci-preview-sample"
          >
            <span class="flex-1">{{ PREVIEW_COPY.sample }}</span>
            <icon-lucide-check
              v-if="radioValue === 'sample'"
              class="size-3 shrink-0"
              aria-hidden="true"
            />
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="none" :class="menuCls.item" data-test-id="ci-preview-none">
            <span class="flex-1">{{ PREVIEW_COPY.none }}</span>
            <icon-lucide-check
              v-if="radioValue === 'none'"
              class="size-3 shrink-0"
              aria-hidden="true"
            />
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator :class="menuCls.separator" />
        <DropdownMenuItem
          :class="menuCls.item"
          :disabled="refreshing || state.kind === 'loading'"
          data-test-id="ci-preview-refresh"
          @select.prevent="refresh()"
        >
          <span class="flex-1">{{ PREVIEW_COPY.refresh }}</span>
          <icon-lucide-refresh-cw
            class="size-3 text-muted"
            :class="refreshing ? 'animate-spin' : ''"
            aria-hidden="true"
          />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
