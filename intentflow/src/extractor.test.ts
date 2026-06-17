import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { extractStrategy, ExtractionRefusedError } from './extractor.js'

function mockClient(parseResult: unknown): Anthropic {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue(parseResult),
    },
  } as unknown as Anthropic
}

describe('extractStrategy', () => {
  it('returns the parsed strategy on success', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      parsed_output: {
        agentAddress: '0xabc',
        maxTotalBudget: 500,
        maxSingleTx: 100,
        allowedProtocols: ['scallop'],
        expiresInDays: 30,
      },
    })

    const result = await extractStrategy('Let my agent trade with a $500 budget', client)

    expect(result).toEqual({
      agentAddress: '0xabc',
      maxTotalBudget: 500,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresInDays: 30,
    })
  })

  it('returns all-null fields when the goal has nothing to extract', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      parsed_output: {
        agentAddress: null,
        maxTotalBudget: null,
        maxSingleTx: null,
        allowedProtocols: null,
        expiresInDays: null,
      },
    })

    const result = await extractStrategy('What is the weather today?', client)

    expect(result.agentAddress).toBeNull()
    expect(result.maxTotalBudget).toBeNull()
  })

  it('throws ExtractionRefusedError on a refusal', async () => {
    const client = mockClient({ stop_reason: 'refusal', parsed_output: undefined })

    await expect(extractStrategy('some goal', client)).rejects.toThrow(ExtractionRefusedError)
  })

  it('throws a generic error when parsed_output is missing for a non-refusal stop reason', async () => {
    const client = mockClient({ stop_reason: 'max_tokens', parsed_output: undefined })

    await expect(extractStrategy('some goal', client)).rejects.toThrow(/parsed output/i)
  })
})
