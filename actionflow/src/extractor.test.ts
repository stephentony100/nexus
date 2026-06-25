import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { extractActionGoal, ExtractionRefusedError } from './extractor.js'

function mockClient(parseResult: unknown): Anthropic {
  return {
    messages: {
      parse: vi.fn().mockResolvedValue(parseResult),
    },
  } as unknown as Anthropic
}

describe('extractActionGoal', () => {
  it('returns the parsed action goal on success', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      parsed_output: { protocol: 'scallop', amount: 100, action: 'supply' },
    })

    const result = await extractActionGoal('deposit $100 into scallop', client)

    expect(result).toEqual({ protocol: 'scallop', amount: 100, action: 'supply' })
  })

  it('returns all-null fields when the goal has nothing to extract', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      parsed_output: { protocol: null, amount: null, action: null },
    })

    const result = await extractActionGoal('what is the weather today?', client)

    expect(result.protocol).toBeNull()
    expect(result.amount).toBeNull()
    expect(result.action).toBeNull()
  })

  it('returns a null action when the goal states protocol and amount but no direction', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      parsed_output: { protocol: 'scallop', amount: 100, action: null },
    })

    const result = await extractActionGoal('do something with $100 in scallop', client)

    expect(result.action).toBeNull()
  })

  it('throws ExtractionRefusedError on a refusal', async () => {
    const client = mockClient({ stop_reason: 'refusal', parsed_output: undefined })

    await expect(extractActionGoal('some goal', client)).rejects.toThrow(ExtractionRefusedError)
  })

  it('throws a generic error when parsed_output is missing for a non-refusal stop reason', async () => {
    const client = mockClient({ stop_reason: 'max_tokens', parsed_output: undefined })

    await expect(extractActionGoal('some goal', client)).rejects.toThrow(/parsed output/i)
  })
})
