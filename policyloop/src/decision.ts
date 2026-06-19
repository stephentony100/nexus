import type { PolicyState } from 'actionflow'

export type PolicyDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'propose'; protocol: string; amount: number }

export function decidePolicyAction(state: PolicyState, nowMs: number): PolicyDecision {
  if (state.paused) {
    return { kind: 'skip', reason: 'policy is paused' }
  }
  if (state.revoked) {
    return { kind: 'skip', reason: 'policy is revoked' }
  }
  if (nowMs > state.expiresAtMs) {
    return { kind: 'skip', reason: `policy expired at ${state.expiresAtMs}` }
  }
  if (state.spentTotal >= state.maxTotalBudget) {
    return { kind: 'skip', reason: 'budget exhausted' }
  }
  if (state.allowedProtocols.length === 0) {
    return { kind: 'skip', reason: 'no allowed protocols' }
  }

  return {
    kind: 'propose',
    protocol: state.allowedProtocols[0],
    amount: Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx),
  }
}
