import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

export const RawStrategySchema = z.object({
  agentAddress: z.string().nullable(),
  maxTotalBudget: z.number().nullable(),
  maxSingleTx: z.number().nullable(),
  allowedProtocols: z.array(z.string()).nullable(),
  expiresInDays: z.number().nullable(),
})

export type RawStrategy = z.infer<typeof RawStrategySchema>

export class ExtractionRefusedError extends Error {
  constructor() {
    super('Claude declined to process this goal')
    this.name = 'ExtractionRefusedError'
  }
}

const SYSTEM_PROMPT = `You translate a user's plain-English request to set up an AI trading agent's spending policy into structured fields.

Extract exactly these fields from the user's goal text:
- agentAddress: the agent's Sui address, ONLY if the user explicitly stated one (e.g. "0x..."). Never invent or guess an address.
- maxTotalBudget: the total budget the agent may spend, as a plain number (no currency symbols).
- maxSingleTx: the maximum amount allowed in a single transaction, as a plain number.
- allowedProtocols: the list of protocol names the agent may use (e.g. ["scallop", "deepbook"]), lowercase.
- expiresInDays: how many days from now the policy should remain valid, as a plain integer. Convert phrases like "next month" to 30, "a week" to 7, etc. Never invent a value the user did not state in some form.

If the user did not state a field, return null for it. Do not guess, default, or infer values that are not present in the text.`

export async function extractStrategy(goal: string, client: Anthropic): Promise<RawStrategy> {
  const message = await client.messages.parse({
    model: 'claude-opus-4-8',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: goal }],
    output_config: { format: zodOutputFormat(RawStrategySchema) },
  })

  if (message.stop_reason === 'refusal') {
    throw new ExtractionRefusedError()
  }

  if (!message.parsed_output) {
    throw new Error(`Claude response had no parsed output (stop_reason: ${message.stop_reason})`)
  }

  return message.parsed_output
}
