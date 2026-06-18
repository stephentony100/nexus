import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

export const RawActionGoalSchema = z.object({
  protocol: z.string().nullable(),
  amount: z.number().nullable(),
})

export type RawActionGoal = z.infer<typeof RawActionGoalSchema>

export class ExtractionRefusedError extends Error {
  constructor() {
    super('Claude declined to process this goal')
    this.name = 'ExtractionRefusedError'
  }
}

const SYSTEM_PROMPT = `You translate a user's plain-English request to take a DeFi action (deposit, withdraw, swap, etc.) through an AI trading agent into structured fields.

Extract exactly these fields from the user's goal text:
- protocol: the lowercase name of the protocol to act on (e.g. "scallop", "deepbook"), ONLY if the user explicitly named one. Never invent or guess a protocol.
- amount: the amount of the action, as a plain number (no currency symbols).

If the user did not state a field, return null for it. Do not guess, default, or infer values that are not present in the text.`

export async function extractActionGoal(goal: string, client: Anthropic): Promise<RawActionGoal> {
  const message = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: goal }],
    output_config: { format: zodOutputFormat(RawActionGoalSchema) },
  })

  if (message.stop_reason === 'refusal') {
    throw new ExtractionRefusedError()
  }

  if (!message.parsed_output) {
    throw new Error(`Claude response had no parsed output (stop_reason: ${message.stop_reason})`)
  }

  return message.parsed_output
}
