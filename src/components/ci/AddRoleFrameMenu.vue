<!-- CI: **Add role frame ▾** — the roles of the format's contract (Track E3d-a, FB-44 §2; Track FB-61, PATCHES H-66). -->
<script setup lang="ts">
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuRoot,
  DropdownMenuTrigger
} from 'reka-ui'
import { computed } from 'vue'

import { useRetainedPopup } from '@open-pencil/vue'

import type { StudioRoleName } from '@/app/ci/api'
import { addRoleFrame, contractRoles, ROLE_LABELS, roleFrames } from '@/app/ci/bindings'
import { hostedSession } from '@/app/ci/boot'
import { useEditorStore } from '@/app/editor/active-store'
import AppButton from '@/components/ui/button/AppButton.vue'
import { useMenuUI } from '@/components/ui/menu/menu'
import Tip from '@/components/ui/overlay/Tip.vue'

export interface AddRoleFrameMenuProps {
  /** Re-read the graph when this changes (the session's graph tick). */
  tick?: number
}

const { tick = 0 } = defineProps<AddRoleFrameMenuProps>()

const ROLE_HINTS: Record<StudioRoleName, string> = {
  cover: 'The first image — every output starts here.',
  repeat: 'One slide per body paragraph in a carousel.',
  ending: 'The closing slide of a carousel (optional).'
}

const store = useEditorStore()
const { open, portalActive } = useRetainedPopup()
const menuCls = useMenuUI({ content: 'min-w-56' })

const format = computed(() => hostedSession.value?.payload.value?.format ?? null)
// Track FB-61 (PATCHES H-66): only the roles of the format's contract are offered — a single-image
// format lists Cover alone; the menu is recovery for a deleted frame, never a "make it a carousel" switch.
const roles = computed(() =>
  contractRoles(format.value, hostedSession.value?.payload.value?.contract ?? null)
)
const existing = computed(() => {
  void tick
  return new Set(roleFrames(store.graph, store.state.currentPageId).map((f) => f.role))
})

function add(role: StudioRoleName) {
  const f = format.value
  if (!f) return
  addRoleFrame(store, role, f)
  open.value = false
}
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <AppButton
        size="xs"
        variant="soft"
        :disabled="!format"
        data-test-id="ci-add-role-frame"
        aria-label="Add role frame"
      >
        Add role frame
        <template #trailing><icon-lucide-chevron-down class="size-3" /></template>
      </AppButton>
    </DropdownMenuTrigger>
    <DropdownMenuPortal v-if="portalActive">
      <DropdownMenuContent align="start" :side-offset="4" :class="menuCls.content">
        <template v-for="role in roles" :key="role">
          <Tip
            :label="existing.has(role) ? `${ROLE_LABELS[role]} already exists` : ROLE_HINTS[role]"
            side="left"
          >
            <DropdownMenuItem
              :class="menuCls.item"
              :disabled="existing.has(role)"
              :data-test-id="`ci-add-role-${role}`"
              @select="add(role)"
            >
              <span class="flex-1">{{ ROLE_LABELS[role] }}</span>
              <span v-if="format" class="tabular-nums text-muted">
                {{ format.width }} × {{ format.height }}
              </span>
            </DropdownMenuItem>
          </Tip>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
