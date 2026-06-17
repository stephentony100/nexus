import { describe, expect, it } from 'vitest'
import { validateStrategy } from './validator.js'
import type { RawStrategy } from './extractor.js'

const NOW = 1_700_000_000_000

function validRaw(overrides: Partial<RawStrategy> = {}): RawStrategy {
  return {
    agentAddress: '0xabc123',
    maxTotalBudget: 500,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresInDays: 30,
    ...overrides,
  }
}

describe('validateStrategy', () => {
  it('accepts a fully valid strategy and derives expiresAtMs', () => {
    const result = validateStrategy(validRaw(), NOW)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.strategy.expiresAtMs).toBe(NOW + 30 * 86_400_000)
      expect(result.strategy.agentAddress).toBe('0xabc123')
    }
  })

  it('accepts maxSingleTx equal to maxTotalBudget (boundary)', () => {
    const result = validateStrategy(validRaw({ maxTotalBudget: 100, maxSingleTx: 100 }), NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects zero maxTotalBudget', () => {
    const result = validateStrategy(validRaw({ maxTotalBudget: 0 }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'maxTotalBudget',
        reason: 'must be greater than 0, got 0',
      })
    }
  })

  it('rejects maxSingleTx greater than maxTotalBudget', () => {
    const result = validateStrategy(validRaw({ maxTotalBudget: 100, maxSingleTx: 150 }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'maxSingleTx',
        reason: 'maxSingleTx (150) exceeds maxTotalBudget (100)',
      })
    }
  })

  it('rejects an empty allowedProtocols list', () => {
    const result = validateStrategy(validRaw({ allowedProtocols: [] }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'allowedProtocols',
        reason: 'must name at least one protocol',
      })
    }
  })

  it('rejects a non-positive expiresInDays', () => {
    const result = validateStrategy(validRaw({ expiresInDays: 0 }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'expiresInDays',
        reason: 'must be greater than 0, got 0',
      })
    }
  })

  it('rejects a malformed agent address', () => {
    const result = validateStrategy(validRaw({ agentAddress: 'not-an-address' }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'agentAddress',
        reason: '"not-an-address" is not a valid Sui address',
      })
    }
  })

  it('reports every missing field when all are null', () => {
    const result = validateStrategy(
      {
        agentAddress: null,
        maxTotalBudget: null,
        maxSingleTx: null,
        allowedProtocols: null,
        expiresInDays: null,
      },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(5)
      expect(result.errors.map((e) => e.field).sort()).toEqual(
        ['agentAddress', 'allowedProtocols', 'expiresInDays', 'maxSingleTx', 'maxTotalBudget'].sort(),
      )
    }
  })
})
