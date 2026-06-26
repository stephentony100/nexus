import { describe, expect, it } from 'vitest'
import type { PolicyState } from 'actionflow'
import { checkEligibility } from './decision.js'

function baseState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0x' + 'aa'.repeat(32),
    maxTotalBudget: 1000,
    spentTotal: 0,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: 2_000_000_000_000,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

describe('checkEligibility', () => {
  it('returns eligible: false when paused', () => {
    expect(checkEligibility(baseState({ paused: true }), 1000)).toEqual({ eligible: false, reason: 'policy is paused' })
  })

  it('returns eligible: false when revoked', () => {
    expect(checkEligibility(baseState({ revoked: true }), 1000)).toEqual({ eligible: false, reason: 'policy is revoked' })
  })

  it('returns eligible: false when expired', () => {
    expect(checkEligibility(baseState({ expiresAtMs: 500 }), 1000)).toEqual({ eligible: false, reason: 'policy expired at 500' })
  })

  it('does not treat nowMs equal to expiresAtMs as expired', () => {
    expect(checkEligibility(baseState({ expiresAtMs: 1000 }), 1000)).toEqual({ eligible: true })
  })

  it('returns eligible: false when budget is exhausted', () => {
    expect(checkEligibility(baseState({ spentTotal: 1000, maxTotalBudget: 1000 }), 1000)).toEqual({
      eligible: false,
      reason: 'budget exhausted',
    })
  })

  it('returns eligible: false when there are no allowed protocols', () => {
    expect(checkEligibility(baseState({ allowedProtocols: [] }), 1000)).toEqual({
      eligible: false,
      reason: 'no allowed protocols',
    })
  })

  it('returns eligible: true when all checks pass', () => {
    expect(checkEligibility(baseState(), 1000)).toEqual({ eligible: true })
  })

  it('checks paused before revoked, expiry, and budget', () => {
    const state = baseState({ paused: true, revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'policy is paused' })
  })

  it('checks revoked before expiry and budget', () => {
    const state = baseState({ revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'policy is revoked' })
  })

  it('checks expiry before budget exhaustion', () => {
    const state = baseState({ expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'policy expired at 0' })
  })

  it('checks budget exhaustion before empty allowed protocols', () => {
    const state = baseState({ spentTotal: 1000, maxTotalBudget: 1000, allowedProtocols: [] })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'budget exhausted' })
  })
})
