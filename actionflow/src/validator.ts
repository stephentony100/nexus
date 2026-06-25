import type { RawActionGoal } from './extractor.js'
import type { FieldError, PolicyAction, PolicyState, ValidationResult } from './types.js'

export function validateAction(
  raw: RawActionGoal,
  state: PolicyState,
  nowMs: number,
  policyId: string,
): ValidationResult {
  const errors: FieldError[] = []

  if (raw.protocol === null) {
    errors.push({ field: 'protocol', reason: 'not specified in goal' })
  }
  if (raw.amount === null) {
    errors.push({ field: 'amount', reason: 'not specified in goal' })
  }
  if (raw.action === null) {
    errors.push({ field: 'action', reason: 'not specified in goal' })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const protocol = raw.protocol as string
  const amount = raw.amount as number
  const action = raw.action as 'supply' | 'withdraw'

  if (state.paused) {
    errors.push({ field: '_root', reason: 'policy is paused' })
  }
  if (state.revoked) {
    errors.push({ field: '_root', reason: 'policy is revoked' })
  }
  if (nowMs > state.expiresAtMs) {
    errors.push({ field: '_root', reason: `policy expired at ${state.expiresAtMs}` })
  }
  if (!state.allowedProtocols.includes(protocol)) {
    errors.push({
      field: 'protocol',
      reason: `"${protocol}" is not in allowed protocols (${state.allowedProtocols.join(', ')})`,
    })
  }
  if (protocol === 'scallop' && action !== 'supply') {
    errors.push({ field: 'action', reason: `scallop ${action} is not supported on-chain yet` })
  }
  if (amount <= 0) {
    errors.push({ field: 'amount', reason: `must be greater than 0, got ${amount}` })
  } else if (amount > state.maxSingleTx) {
    errors.push({ field: 'amount', reason: `amount (${amount}) exceeds maxSingleTx (${state.maxSingleTx})` })
  } else if (state.spentTotal + amount > state.maxTotalBudget) {
    errors.push({
      field: 'amount',
      reason: `spentTotal (${state.spentTotal}) + amount (${amount}) exceeds maxTotalBudget (${state.maxTotalBudget})`,
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const validatedAction: PolicyAction = { policyId, protocol, amount, action }
  return { ok: true, action: validatedAction }
}
