// CI (Track FB-61, PATCHES H-67): the format-aware Bindings checklist — the
// app's `contractRows` / `contractHelperWords` twin (`src/lib/bindings-words.ts`).
// The payload carries the app's rows for the SAVED version; the panel re-judges
// `met` / `words` over the LIVE report so the checklist follows every edit,
// keeping the app's labels, requirement words and helper sentence.

import type { StudioContractPayload, StudioContractRow, StudioFormat, StudioRoleName } from './api'
import {
  type BindingReason,
  type BindingsReport,
  bindingReasonWords,
  BLOCKING,
  contractRoles,
  ROLE_LABELS
} from './bindings'

const ROLE_NEEDS: Record<
  StudioRoleName,
  { requirement: StudioContractRow['requirement']; verb: string; needs: string }
> = {
  cover: {
    requirement: 'required',
    verb: 'needs',
    needs: 'content:title or content:body'
  },
  repeat: { requirement: null, verb: 'needs', needs: 'content:body' },
  ending: { requirement: 'optional', verb: 'takes', needs: 'content:cta' }
}

export const CONTRACT_ROW_MET = 'met'
export const CONTRACT_ROW_NOT_MET_PREFIX = 'not met — '
export const CONTRACT_ROW_OPTIONAL_MISSING = 'not added — optional'
export const CONTRACT_HELPER_SINGLE = 'This format is a single image. Design the Cover.'

/** "Cover (required) — needs content:title or content:body" · "Repeat — needs content:body" · "Ending (optional) — takes content:cta" */
export function contractRowLabel(role: StudioRoleName): string {
  const spec = ROLE_NEEDS[role]
  const requirement = spec.requirement ? ` (${spec.requirement})` : ''
  return `${ROLE_LABELS[role]}${requirement} — ${spec.verb} ${spec.needs}`
}

export function contractHelperWords(contract: { carousel: boolean; slideCap: number }): string {
  if (!contract.carousel) return CONTRACT_HELPER_SINGLE
  return `Cover is the first slide. Long pieces fill Repeat slides (up to ${contract.slideCap}) and end on Ending.`
}

/** The contract as the panel reads it — the payload's block, or one derived from the format on an older app. */
export function contractOf(
  format: Pick<StudioFormat, 'slideCap'> | null,
  payload: StudioContractPayload | null | undefined
): Pick<StudioContractPayload, 'roles' | 'slideCap' | 'carousel' | 'helper'> {
  if (payload) return payload
  const roles = [...contractRoles(format, null)]
  const slideCap = format?.slideCap ?? 1
  const carousel = roles.length > 1
  return {
    roles,
    slideCap,
    carousel,
    helper: contractHelperWords({ carousel, slideCap })
  }
}

function contractRowWords(
  name: StudioRoleName,
  spec: { requirement: StudioContractRow['requirement']; needs: string },
  present: boolean,
  met: boolean,
  blocking: BindingReason | null
): string {
  if (met) return CONTRACT_ROW_MET
  if (present) {
    const why = blocking ? bindingReasonWords(blocking) : `${name} has no ${spec.needs}`
    return `${CONTRACT_ROW_NOT_MET_PREFIX}${why}`
  }
  if (spec.requirement === 'optional') return CONTRACT_ROW_OPTIONAL_MISSING
  if (name === 'cover')
    return `${CONTRACT_ROW_NOT_MET_PREFIX}${bindingReasonWords({ code: 'no_cover' })}`
  return `${CONTRACT_ROW_NOT_MET_PREFIX}add a ${name} frame with ${spec.needs}`
}

/** The checklist rows over the LIVE report, in contract order; labels from the payload when it has them. */
export function contractChecklist(
  contract: Pick<StudioContractPayload, 'roles'> & Partial<Pick<StudioContractPayload, 'rows'>>,
  report: Pick<BindingsReport, 'roles'>
): StudioContractRow[] {
  return contract.roles.map((name) => {
    const fromPayload = contract.rows?.find((r) => r.role === name)
    const role = report.roles.find((r) => r.role === name)
    const spec = ROLE_NEEDS[name]
    const present = role?.present ?? false
    const blocking = role?.reasons.find((r) => BLOCKING.has(r.code)) ?? null
    const met = name === 'ending' ? present : present && blocking === null
    const words = contractRowWords(name, spec, present, met, blocking)
    return {
      role: name,
      label: fromPayload?.label ?? contractRowLabel(name),
      requirement: fromPayload?.requirement ?? spec.requirement,
      needs: fromPayload?.needs ?? spec.needs,
      present,
      met,
      words
    }
  })
}
