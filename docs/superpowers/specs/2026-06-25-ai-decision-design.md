# AI-Driven PolicyLoop Decisions — Design Spec

**Date:** 2026-06-25
**Scope:** `policyloop` package only (`decision.ts`, new `aiDecision.ts`, `index.ts`)

---

## Overview

Replace the hardcoded proposal logic with a Claude strategy call that picks the best protocol, sizes the amount intelligently, and can recommend skipping a cycle with a structured justification. Deterministic eligibility guards continue to run before Claude is consulted. Claude never replaces safety checks — it only acts after the policy is proven eligible.

**Trust boundary:** Claude is not trusted to enforce policy constraints. It recommends a strategy; the deterministic pipeline remains the authority that validates and executes transactions. AI decisions are advisory only and validated twice: once immediately after parsing (protocol, amount, runtime constraints) and again by the existing `validateAction()` pipeline before PTB construction.

---

## Architecture

```
fetchPolicyState
    ↓
checkEligibility (deterministic)        ← decision.ts
    ↓ eligible: false → skip
    ↓ eligible: true
consultDecisionAI (Claude strategy)     ← aiDecision.ts
    ↓ kind: 'skip' → skip
    ↓ kind: 'propose'
validateAction → buildActionPtb → submitTransaction   ← existing pipeline
```

Separation of responsibilities:
- **`decision.ts`** — deterministic eligibility only (paused / revoked / expired / budget exhausted / no protocols)
- **`aiDecision.ts`** — Claude strategy only (protocol selection, amount sizing, optional skip)
- **`index.ts`** — orchestration only (composes the above, handles backward compat)

---

## Module Specification

### `decision.ts` — eligibility check

**Function renamed:** `decidePolicyAction` → `checkEligibility` (the function no longer decides an action, it only answers whether execution is permitted).

**New return type** (replaces `PolicyDecision`):

```ts
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string }
```

`checkEligibility(state, nowMs)` keeps all existing guard checks in the same order (paused → revoked → expired → budget exhausted → no protocols) and returns `{ eligible: true }` when all pass. No "propose" logic remains in this file.

Existing tests updated to use new function name and assert `EligibilityResult` shapes. No logic changes.

---

### `aiDecision.ts` — Claude strategy (new file)

**Zod schema:**

`action` is intentionally omitted from `AiDecisionSchema`. This phase only supports supply, so `action: 'supply'` is added by the orchestrator after parsing — Claude cannot accidentally emit `'withdraw'` or `'swap'`.

```ts
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

export type AiDecision = z.infer<typeof AiDecisionSchema>
```

**Function signature:**

```ts
export async function consultDecisionAI(
  state: PolicyState,
  client: Anthropic,
  options?: {
    marketContext?: string
    throwOnAiFailure?: boolean
  },
): Promise<AiDecision>
```

**System prompt:**

```
You are a DeFi treasury strategy agent managing a policy on the Sui blockchain.
The policy has already passed all eligibility checks. Your job is to decide
what action to take, where, and how much.

Policy constraints (hard limits — do not exceed them):
- Allowed protocols: {{allowedProtocols}}
- Remaining budget: {{remainingBudget}} MIST (= {{remainingSui}} SUI)
- Max single transaction: {{maxSingleTx}} MIST
- Time to expiry: {{timeToExpiryHours}} hours

Market context:
{{marketContext ?? "No live market data provided. Do not invent current APYs or protocol health."}}

Rules:
- You MUST pick a protocol from the allowed list only. Do not invent protocol names.
- amount must be a positive integer ≤ min(remainingBudget, maxSingleTx) in MIST.
- Market context is the only source of truth for live yields or protocol health.
  Do not invent current APYs, TVL, risk events, or protocol health.
  If live market data is absent, say so in the reasoning and make a conservative decision.
- If, based on the provided constraints and market context (if any), you cannot justify
  a deployment, return kind: "skip" with a clear reason.
- If you propose an action, include your reasoning so the decision is auditable.
```

**Error handling (in priority order):**

1. **Disallowed protocol in response** — `!allowedProtocols.includes(decision.protocol)`:
   - If `throwOnAiFailure`: throw `Error('AI proposed disallowed protocol: <name>')`
   - Otherwise: return `{ kind: 'skip', reason: 'AI proposed disallowed protocol: <name>' }`

2. **Invalid amount** — amount > min(remainingBudget, maxSingleTx) (post-parse ceiling check; negative/zero is caught at parse time by `z.number().int().positive()`):
   - If `throwOnAiFailure`: throw
   - Otherwise: return `{ kind: 'skip', reason: 'AI proposed amount exceeds policy limits' }`

3. **Claude API error / parse error** (caught in try/catch):
   - If `throwOnAiFailure`: rethrow
   - Otherwise: return `{ kind: 'skip', reason: 'AI decision unavailable', errorType: 'rate_limit' | 'network' | 'parse' | 'unknown' }`

The `errorType` field on AI-failure skips is machine-readable for daemon logging. The `reason` string is human-readable and surfaced to callers unchanged.

---

### `index.ts` — orchestration changes

**`PolicyLoopOptions` gains:**

```ts
ai?: {
  client: Anthropic
  marketContext?: string
  throwOnAiFailure?: boolean
}
```

**`runPolicyCycle` flow:**

```ts
const eligibility = checkEligibility(state, nowMs)
if (!eligibility.eligible) {
  return { ok: true, status: 'skipped', reason: eligibility.reason }
}

let decision: { protocol: string; amount: number; action: 'supply' }
if (opts.ai) {
  const aiDecision = await consultDecisionAI(state, opts.ai.client, {
    marketContext: opts.ai.marketContext,
    throwOnAiFailure: opts.ai.throwOnAiFailure,
  })
  if (aiDecision.kind === 'skip') {
    return { ok: true, status: 'skipped', reason: aiDecision.reason }
  }
  // action: 'supply' added here — not generated by Claude — so Claude cannot
  // accidentally emit an unsupported action type.
  decision = { ...aiDecision, action: 'supply' }
} else {
  // Legacy mode: maintained solely for backward compatibility with existing callers
  // that have not configured an AI client. It is NOT used as a fallback after AI
  // failures — if opts.ai is provided but Claude fails, the cycle skips.
  decision = {
    protocol: state.allowedProtocols[0],
    amount: Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx),
    action: 'supply',
  }
}
// decision flows into existing validateAction → buildActionPtb → submitTransaction
```

**CLI (`policyloop/bin/policyloop.ts`):** reads `ANTHROPIC_API_KEY` env var. If present, constructs an `Anthropic` client and populates `opts.ai`. Reads `POLICYLOOP_MARKET_CONTEXT` env var (optional free-form string) for `marketContext`. Reads `POLICYLOOP_THROW_ON_AI_FAILURE=true` for dev/test mode.

---

## Test Plan

### `decision.test.ts`
All existing tests updated to call `checkEligibility` (renamed) and assert `EligibilityResult` shapes:
- `{ eligible: false, reason: 'policy is paused' }` etc.
- `{ eligible: true }` for the all-passing case

### `aiDecision.test.ts` (new)
Mock Anthropic client via `vi.mock`. Cases:
1. Valid propose — Claude returns valid protocol + amount → `{ kind: 'propose', protocol, amount, reasoning }`
2. Valid skip — Claude returns skip → `{ kind: 'skip', reason }`
3. Disallowed protocol, `throwOnAiFailure: false` → skip with reason
4. Disallowed protocol, `throwOnAiFailure: true` → throws
5. Amount above ceiling, `throwOnAiFailure: false` → skip
6. Amount above ceiling, `throwOnAiFailure: true` → throws
7. API error, `throwOnAiFailure: false` → `{ kind: 'skip', reason: 'AI decision unavailable', errorType }`
8. API error, `throwOnAiFailure: true` → rethrows

### `index.test.ts`
Mock `checkEligibility` and `consultDecisionAI`. Cases:
1. Eligibility returns `eligible: false` → skipped, AI never called
2. `opts.ai` + AI proposes → `action: 'supply'` added, validate + build + submit called
3. `opts.ai` + AI skips → cycle skipped, submit not called
4. No `opts.ai` → legacy deterministic propose used (backward compat)

---

## Open Questions / Future Work

- **Model choice:** implementation uses `claude-haiku-4-5` (cheap, fast for autonomous loops).
- **Phase 3 (C):** when trusted market data (oracle/indexer) is available, `marketContext?: string` can be replaced with structured data. No architectural changes needed — `consultDecisionAI`'s options type is already open for extension.
- **Reasoning logging:** the `reasoning` field on propose decisions is surfaced to callers via `AiDecision` but not persisted by policyloop itself. Callers (CLI, daemon) log it as they see fit.
