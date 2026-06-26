import type Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import type { PolicyState } from 'actionflow'

const AiDecisionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skip'),
    reason: z.string(),
  }),
  z.object({
    kind: z.literal('propose'),
    protocol: z.string(),
    amount: z.number().int().positive(),
    reasoning: z.string(),
  }),
])

export type AiDecision =
  | { kind: 'skip'; reason: string; errorType?: 'rate_limit' | 'network' | 'parse' | 'unknown' }
  | { kind: 'propose'; protocol: string; amount: number; reasoning: string }

function buildSystemPrompt(state: PolicyState, nowMs: number, marketContext?: string): string {
  const remainingBudget = state.maxTotalBudget - state.spentTotal
  const timeToExpiryHours = ((state.expiresAtMs - nowMs) / (1000 * 60 * 60)).toFixed(1)
  return `You are a DeFi treasury strategy agent managing a policy on the Sui blockchain.
The policy has already passed all eligibility checks. Your job is to decide
what action to take, where, and how much.

Policy constraints (hard limits — do not exceed them):
- Allowed protocols: ${state.allowedProtocols.join(', ')}
- Remaining budget: ${remainingBudget} MIST (= ${(remainingBudget / 1e9).toFixed(4)} SUI)
- Max single transaction: ${state.maxSingleTx} MIST
- Time to expiry: ${timeToExpiryHours} hours

Market context:
${marketContext ?? 'No live market data provided. Do not invent current APYs or protocol health.'}

Rules:
- You MUST pick a protocol from the allowed list only. Do not invent protocol names.
- amount must be a positive integer ≤ min(remainingBudget, maxSingleTx) in MIST.
- Market context is the only source of truth for live yields or protocol health.
  Do not invent current APYs, TVL, risk events, or protocol health.
  If live market data is absent, say so in the reasoning and make a conservative decision.
- If, based on the provided constraints and market context (if any), you cannot justify
  a deployment, return kind: "skip" with a clear reason.
- If you propose an action, include your reasoning so the decision is auditable.`
}

function classifyError(error: unknown): 'rate_limit' | 'network' | 'parse' | 'unknown' {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase()
    if (msg.includes('rate') || msg.includes('429')) return 'rate_limit'
    if (msg.includes('network') || msg.includes('fetch') || msg.includes('connect')) return 'network'
    if (msg.includes('parse') || msg.includes('json') || msg.includes('schema')) return 'parse'
  }
  return 'unknown'
}

export async function consultDecisionAI(
  state: PolicyState,
  client: Anthropic,
  options?: {
    marketContext?: string
    throwOnAiFailure?: boolean
  },
): Promise<AiDecision> {
  const { marketContext, throwOnAiFailure = false } = options ?? {}
  const nowMs = Date.now()
  const amountCeiling = Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx)

  let parsed: z.infer<typeof AiDecisionSchema>

  try {
    const message = await client.messages.parse({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: buildSystemPrompt(state, nowMs, marketContext),
      messages: [{ role: 'user', content: 'Decide now.' }],
      output_config: { format: zodOutputFormat(AiDecisionSchema) },
    })

    if (!message.parsed_output) {
      throw new Error(`Claude response had no parsed output (stop_reason: ${message.stop_reason})`)
    }

    parsed = message.parsed_output
  } catch (error) {
    if (throwOnAiFailure) throw error
    return { kind: 'skip', reason: 'AI decision unavailable', errorType: classifyError(error) }
  }

  if (parsed.kind === 'propose') {
    if (!state.allowedProtocols.includes(parsed.protocol)) {
      const msg = `AI proposed disallowed protocol: ${parsed.protocol}`
      if (throwOnAiFailure) throw new Error(msg)
      return { kind: 'skip', reason: msg }
    }

    if (parsed.amount > amountCeiling) {
      const msg = `AI proposed amount ${parsed.amount} exceeds policy limits (ceiling: ${amountCeiling})`
      if (throwOnAiFailure) throw new Error(msg)
      return { kind: 'skip', reason: 'AI proposed amount exceeds policy limits' }
    }
  }

  return parsed
}
