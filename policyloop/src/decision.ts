import type { PolicyState } from 'actionflow'

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string }

export function checkEligibility(state: PolicyState, nowMs: number): EligibilityResult {
  if (state.paused) return { eligible: false, reason: 'policy is paused' }
  if (state.revoked) return { eligible: false, reason: 'policy is revoked' }
  if (nowMs > state.expiresAtMs) return { eligible: false, reason: `policy expired at ${state.expiresAtMs}` }
  if (state.spentTotal >= state.maxTotalBudget) return { eligible: false, reason: 'budget exhausted' }
  if (state.allowedProtocols.length === 0) return { eligible: false, reason: 'no allowed protocols' }
  return { eligible: true }
}
