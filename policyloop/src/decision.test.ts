import { describe, expect, it } from 'vitest'
import type { PolicyState } from 'actionflow'
import { decidePolicyAction } from './decision.js'

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

describe('decidePolicyAction', () => {
  it('skips when paused', () => {
    const state = baseState({ paused: true })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is paused' })
  })

  it('skips when revoked', () => {
    const state = baseState({ revoked: true })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is revoked' })
  })

  it('skips when expired', () => {
    const state = baseState({ expiresAtMs: 500 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy expired at 500' })
  })

  it('does not treat nowMs equal to expiresAtMs as expired', () => {
    const state = baseState({ expiresAtMs: 1000, maxTotalBudget: 100, spentTotal: 0, maxSingleTx: 50 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 50 })
  })

  it('skips when budget is exhausted', () => {
    const state = baseState({ spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'budget exhausted' })
  })

  it('skips when there are no allowed protocols', () => {
    const state = baseState({ allowedProtocols: [] })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'no allowed protocols' })
  })

  it('proposes the first allowed protocol capped at maxSingleTx', () => {
    const state = baseState({ maxTotalBudget: 1000, spentTotal: 0, maxSingleTx: 100, allowedProtocols: ['scallop', 'navi'] })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 100 })
  })

  it('caps the proposed amount at the remaining budget when it is smaller than maxSingleTx', () => {
    const state = baseState({ maxTotalBudget: 1000, spentTotal: 970, maxSingleTx: 100 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 30 })
  })

  it('checks paused before revoked, expiry, and budget', () => {
    const state = baseState({ paused: true, revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is paused' })
  })

  it('checks revoked before expiry and budget', () => {
    const state = baseState({ revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is revoked' })
  })

  it('checks expiry before budget exhaustion', () => {
    const state = baseState({ expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy expired at 0' })
  })

  it('checks budget exhaustion before empty allowed protocols', () => {
    const state = baseState({ spentTotal: 1000, maxTotalBudget: 1000, allowedProtocols: [] })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'budget exhausted' })
  })
})
