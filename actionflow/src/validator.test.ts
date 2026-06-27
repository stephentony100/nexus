import { describe, expect, it } from 'vitest'
import { validateAction } from './validator.js'
import type { RawActionGoal } from './extractor.js'
import type { PolicyState } from './types.js'

const NOW = 1_700_000_000_000
const POLICY_ID = '0xpolicy'

function validRaw(overrides: Partial<RawActionGoal> = {}): RawActionGoal {
  return {
    protocol: 'scallop',
    amount: 100,
    action: 'supply',
    ...overrides,
  }
}

function validState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0xagent',
    maxTotalBudget: 500,
    spentTotal: 100,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: NOW + 1_000_000,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

describe('validateAction', () => {
  it('accepts a fully valid action', () => {
    const result = validateAction(validRaw(), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action).toEqual({ policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' })
    }
  })

  it('accepts amount equal to maxSingleTx (boundary)', () => {
    const result = validateAction(validRaw({ amount: 100 }), validState({ maxSingleTx: 100 }), NOW, POLICY_ID)
    expect(result.ok).toBe(true)
  })

  it('accepts spentTotal + amount equal to maxTotalBudget (boundary)', () => {
    const result = validateAction(
      validRaw({ amount: 400 }),
      validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 400 }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a paused policy', () => {
    const result = validateAction(validRaw(), validState({ paused: true }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: '_root', reason: 'policy is paused' })
    }
  })

  it('rejects a revoked policy', () => {
    const result = validateAction(validRaw(), validState({ revoked: true }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: '_root', reason: 'policy is revoked' })
    }
  })

  it('rejects an expired policy', () => {
    const result = validateAction(validRaw(), validState({ expiresAtMs: NOW - 1 }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: '_root', reason: `policy expired at ${NOW - 1}` })
    }
  })

  it('rejects a protocol not in allowedProtocols', () => {
    const result = validateAction(validRaw({ protocol: 'deepbook' }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'protocol',
        reason: '"deepbook" is not in allowed protocols (scallop)',
      })
    }
  })

  it('rejects a null amount', () => {
    const result = validateAction(validRaw({ amount: null }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'amount', reason: 'not specified in goal' })
    }
  })

  it('rejects a non-positive amount', () => {
    const result = validateAction(validRaw({ amount: 0 }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'amount', reason: 'must be greater than 0, got 0' })
    }
  })

  it('rejects an amount over maxSingleTx', () => {
    const result = validateAction(validRaw({ amount: 150 }), validState({ maxSingleTx: 100 }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'amount',
        reason: 'amount (150) exceeds maxSingleTx (100)',
      })
    }
  })

  it('rejects an amount that exceeds remaining budget', () => {
    const result = validateAction(
      validRaw({ amount: 450 }),
      validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 500 }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'amount',
        reason: 'spentTotal (100) + amount (450) exceeds maxTotalBudget (500)',
      })
    }
  })

  it('rejects a null protocol and null amount together', () => {
    const result = validateAction(validRaw({ protocol: null, amount: null }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(2)
      expect(result.errors.map((e) => e.field).sort()).toEqual(['amount', 'protocol'])
    }
  })

  it('rejects a null action', () => {
    const result = validateAction(validRaw({ action: null }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'action', reason: 'not specified in goal' })
    }
  })

  it('rejects a scallop withdraw as not yet supported on-chain', () => {
    const result = validateAction(validRaw({ action: 'withdraw' }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'action',
        reason: 'scallop withdraw is not supported on-chain yet',
      })
    }
  })

  it('rejects deepbook + supply as an invalid action for this protocol', () => {
    const result = validateAction(
      validRaw({ protocol: 'deepbook', action: 'supply' }),
      validState({ allowedProtocols: ['deepbook'] }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'action',
        reason: "deepbook does not support 'supply'; use 'swap' or 'place_limit_order'",
      })
    }
  })

  it('accepts a withdraw action for a non-scallop protocol', () => {
    const result = validateAction(
      validRaw({ protocol: 'deepbook', action: 'withdraw' }),
      validState({ allowedProtocols: ['deepbook'] }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(true)
  })
})
