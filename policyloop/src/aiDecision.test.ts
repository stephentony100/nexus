import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { PolicyState } from 'actionflow'
import { consultDecisionAI } from './aiDecision.js'

function basePolicyState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0x' + 'bb'.repeat(32),
    maxTotalBudget: 1000,
    spentTotal: 0,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: 9_999_999_999_999,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

function makeClient(parsedOutput: unknown): Anthropic {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue({ parsed_output: parsedOutput, stop_reason: 'end_turn' }),
    },
  } as unknown as Anthropic
}

describe('consultDecisionAI', () => {
  it('returns propose when Claude returns a valid protocol and amount', async () => {
    const client = makeClient({ kind: 'propose', protocol: 'scallop', amount: 50, reasoning: 'good yield' })
    const result = await consultDecisionAI(basePolicyState(), client)
    expect(result).toEqual({ kind: 'propose', protocol: 'scallop', amount: 50, reasoning: 'good yield' })
  })

  it('returns skip when Claude returns kind: skip', async () => {
    const client = makeClient({ kind: 'skip', reason: 'no good opportunities' })
    const result = await consultDecisionAI(basePolicyState(), client)
    expect(result).toEqual({ kind: 'skip', reason: 'no good opportunities' })
  })

  it('returns skip when Claude proposes a disallowed protocol and throwOnAiFailure is false', async () => {
    const client = makeClient({ kind: 'propose', protocol: 'navi', amount: 50, reasoning: 'high yield' })
    const result = await consultDecisionAI(basePolicyState(), client, { throwOnAiFailure: false })
    expect(result).toEqual({ kind: 'skip', reason: 'AI proposed disallowed protocol: navi' })
  })

  it('throws when Claude proposes a disallowed protocol and throwOnAiFailure is true', async () => {
    const client = makeClient({ kind: 'propose', protocol: 'navi', amount: 50, reasoning: 'high yield' })
    await expect(consultDecisionAI(basePolicyState(), client, { throwOnAiFailure: true })).rejects.toThrow(
      'AI proposed disallowed protocol: navi',
    )
  })

  it('returns skip when Claude proposes amount above ceiling and throwOnAiFailure is false', async () => {
    const client = makeClient({ kind: 'propose', protocol: 'scallop', amount: 9999, reasoning: 'all in' })
    const result = await consultDecisionAI(basePolicyState({ maxSingleTx: 100 }), client, { throwOnAiFailure: false })
    expect(result).toEqual({ kind: 'skip', reason: 'AI proposed amount exceeds policy limits' })
  })

  it('throws when Claude proposes amount above ceiling and throwOnAiFailure is true', async () => {
    const client = makeClient({ kind: 'propose', protocol: 'scallop', amount: 9999, reasoning: 'all in' })
    await expect(
      consultDecisionAI(basePolicyState({ maxSingleTx: 100 }), client, { throwOnAiFailure: true }),
    ).rejects.toThrow('AI proposed amount')
  })

  it('returns skip with errorType when the Claude API throws and throwOnAiFailure is false', async () => {
    const client = {
      messages: { parse: vi.fn().mockRejectedValue(new Error('rate limit exceeded 429')) },
    } as unknown as Anthropic
    const result = await consultDecisionAI(basePolicyState(), client, { throwOnAiFailure: false })
    expect(result).toEqual({ kind: 'skip', reason: 'AI decision unavailable', errorType: 'rate_limit' })
  })

  it('rethrows when the Claude API throws and throwOnAiFailure is true', async () => {
    const client = {
      messages: { parse: vi.fn().mockRejectedValue(new Error('network connection failed')) },
    } as unknown as Anthropic
    await expect(consultDecisionAI(basePolicyState(), client, { throwOnAiFailure: true })).rejects.toThrow(
      'network connection failed',
    )
  })

  it('passes the correct model, output_config, and policy state to the Claude API', async () => {
    const client = makeClient({ kind: 'skip', reason: 'no opportunities' })
    const state = basePolicyState({ allowedProtocols: ['scallop', 'navi'], maxSingleTx: 200 })
    await consultDecisionAI(state, client)
    const callArgs = vi.mocked(client.messages.parse).mock.calls[0][0]
    expect(callArgs.model).toBe('claude-haiku-4-5-20251001')
    expect(callArgs.output_config).toBeDefined()
    expect(callArgs.output_config!.format).toBeDefined()
    expect(callArgs.system).toContain('scallop, navi')
    expect(callArgs.system).toContain('200')
  })

  it('includes marketContext in the system prompt when provided', async () => {
    const client = makeClient({ kind: 'skip', reason: 'low yield' })
    await consultDecisionAI(basePolicyState(), client, { marketContext: 'scallop APY: 8.5%' })
    const callArgs = vi.mocked(client.messages.parse).mock.calls[0][0]
    expect(callArgs.system).toContain('scallop APY: 8.5%')
  })
})
