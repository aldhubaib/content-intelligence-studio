<!-- CI: the **Names** tab — every layer name the system fills, click to copy, Rename selected layer (Track FB-65, ADR-058 §8). -->
<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { useSelectionState } from '@open-pencil/vue'

import { DEFAULT_VOCABULARY } from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import {
  copyText,
  NAMES_COPY,
  NAMES_STATUS_MS,
  namesGroups,
  renameSelectedLayer,
  renameStatusWords,
  type NameRow
} from '@/app/ci/names'
import { useEditorStore } from '@/app/editor/active-store'
import IconButton from '@/components/ui/button/IconButton.vue'

const store = useEditorStore()
const { selectedCount } = useSelectionState()

const payload = computed(() => hostedSession.value?.payload.value ?? null)
const vocabulary = computed(() => payload.value?.bindings.vocabulary ?? DEFAULT_VOCABULARY)
const assets = computed(() => payload.value?.brand?.assets ?? [])
/** Rows come from the payload alone — nothing here names a slot. */
const groups = computed(() => namesGroups(vocabulary.value, assets.value))
const hasSelection = computed(() => selectedCount.value > 0)

/** One row's transient status — **Copied** / the rename sentence — cleared after `NAMES_STATUS_MS`. */
const status = ref<{ name: string; words: string } | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

function flash(name: string, words: string) {
  if (timer) clearTimeout(timer)
  status.value = { name, words }
  timer = setTimeout(() => {
    status.value = null
    timer = null
  }, NAMES_STATUS_MS)
}

onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})

async function copy(row: NameRow) {
  const ok = await copyText(row.name)
  flash(row.name, ok ? NAMES_COPY.copied : NAMES_COPY.copyFailed)
}

function rename(row: NameRow) {
  const result = renameSelectedLayer(store, row.name)
  if (!result) return
  flash(row.name, renameStatusWords(result, row.name))
}

function statusFor(row: NameRow): string {
  return status.value?.name === row.name ? status.value.words : ''
}

/** A stable, selector-safe slug per row (`content:title` → `content-title`) for ids and test ids. */
function slug(row: NameRow): string {
  return row.name
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
}
</script>

<template>
  <!-- Two columns where the panel is wide enough (≥ 22 rem, a container query); stacked name-over-sentence in a narrow panel. -->
  <div
    class="@container flex min-h-0 flex-1 flex-col overflow-y-auto"
    data-test-id="ci-names-panel"
    :data-selection="hasSelection ? 'true' : 'false'"
  >
    <p class="px-3 pt-3 pb-2 text-[11px] text-muted" data-test-id="ci-names-lead">
      {{ NAMES_COPY.lead }}
    </p>
    <section
      v-for="group in groups"
      :key="group.key"
      class="border-t border-border"
      :aria-labelledby="`ci-names-heading-${group.key}`"
      :data-test-id="`ci-names-group-${group.key}`"
    >
      <h3
        :id="`ci-names-heading-${group.key}`"
        class="px-3 pt-2.5 pb-1 text-[11px] font-semibold text-surface"
      >
        {{ group.heading }}
      </h3>
      <!-- Track FB-69: the Brand text group carries one sentence under its heading. -->
      <p
        v-if="group.lead"
        class="px-3 pb-1 text-[11px] text-muted"
        :data-test-id="`ci-names-group-lead-${group.key}`"
      >
        {{ group.lead }}
      </p>
      <div
        class="hidden grid-cols-[minmax(0,11rem)_minmax(0,1fr)] gap-x-2 px-3 pb-1 text-[10px] text-muted @[22rem]:grid"
        aria-hidden="true"
      >
        <span>{{ NAMES_COPY.columns.name }}</span>
        <span>{{ NAMES_COPY.columns.description }}</span>
      </div>
      <ul class="flex flex-col pb-2" :aria-label="group.heading">
        <li
          v-for="row in group.rows"
          :key="row.name"
          class="group/name flex items-stretch gap-1 pr-2"
          :class="row.sub ? 'pl-6' : 'pl-2'"
          :data-test-id="`ci-name-row-${slug(row)}`"
          :data-kind="row.kind"
        >
          <button
            type="button"
            class="grid min-w-0 flex-1 grid-cols-1 items-baseline gap-x-2 gap-y-0.5 rounded px-1 py-1 text-left hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent @[22rem]:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]"
            :aria-label="NAMES_COPY.copyLabel(row.name)"
            :aria-describedby="`ci-names-status-${slug(row)}`"
            :data-test-id="`ci-name-copy-${slug(row)}`"
            @click="copy(row)"
          >
            <code class="truncate font-mono text-[11px] text-surface" :title="row.name">{{
              row.name
            }}</code>
            <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[11px] leading-snug text-muted">
              <span v-if="row.description" class="min-w-0 flex-1">{{ row.description }}</span>
              <!-- Always in the DOM so the live region announces the change; hidden by opacity only, no motion under reduced motion. -->
              <span
                :id="`ci-names-status-${slug(row)}`"
                role="status"
                class="basis-full text-[10px] font-semibold text-success motion-safe:transition-opacity motion-safe:duration-150"
                :class="statusFor(row) ? 'opacity-100' : 'opacity-0'"
                :data-test-id="`ci-name-status-${slug(row)}`"
              >
                {{ statusFor(row) }}
              </span>
            </span>
          </button>
          <IconButton
            v-if="hasSelection && row.renamable"
            :label="NAMES_COPY.renameLabel(row.name)"
            side="left"
            class="my-0.5 shrink-0 self-center"
            :data-test-id="`ci-name-rename-${slug(row)}`"
            @click="rename(row)"
          >
            <icon-lucide-text-cursor-input class="size-3" />
          </IconButton>
        </li>
      </ul>
    </section>
  </div>
</template>
