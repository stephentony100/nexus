import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('./extractor.js', () => ({
  extractStrategy: vi.fn(),
  ExtractionRefusedError: class ExtractionRefusedError extends Error {},
}))

import { extractStrategy } from './extractor.js'
import { translateGoal } from './index.js'

describe('translateGoal', () => {
  it('returns strategy and ptbBytes on a full happy path', async () => {
    vi.mocked(extractStrategy).mockResolvedValue({
      agentAddress: '0x' + 'ab'.repeat(32),
      maxTotalBudget: 500,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresInDays: 30,
    })

    const result = await translateGoal('Let my agent trade with a $500 budget', {
      packageId: '0x' + '11'.repeat(32),
      client: {} as Anthropic,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.strategy.maxTotalBudget).toBe(500)
      expect(typeof result.ptbBytes).toBe('string')
      expect(result.ptbBytes.length).toBeGreaterThan(0)
    }
  })

  it('returns validation errors without building a PTB', async () => {
    vi.mocked(extractStrategy).mockResolvedValue({
      agentAddress: null,
      maxTotalBudget: 500,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresInDays: 30,
    })

    const result = await translateGoal('goal missing an address', {
      packageId: '0x' + '11'.repeat(32),
      client: {} as Anthropic,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'agentAddress', reason: 'not specified in goal' })
    }
  })
})
