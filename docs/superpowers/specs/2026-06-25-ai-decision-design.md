# AI-Driven PolicyLoop Decisions — Design Spec

**Date:** 2026-06-25
**Scope:** `policyloop` package only (`decision.ts`, new `aiDecision.ts`, `index.ts`)

---

## Overview

Replace the hardcoded `decidePolicyAction` proposal logic with a Claude strategy call that picks the best protocol, sizes the amount intelligently, and can recommend skipping a cycle with a structured justification. Deterministic eligibility guards continue to run before Claude is consulted. Claude never replaces safety checks — it only acts after the policy is proven eligible.

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

**New return type** (replaces `PolicyDecision`):

```ts
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string }
```

`decidePolicyAction(state, nowMs)` keeps all existing guard checks in the same order (paused → revoked → expired → budget exhausted → no protocols) and returns `{ eligible: true }` when all pass. No "propose" logic remains in this file.

Existing tests are updated to assert `EligibilityResult` shapes. No logic changes.

---

### `aiDecision.ts` — Claude strategy (new file)

**Zod schema:**

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
    action: z.literal('supply'),
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
{{marketContext ?? "No live market data provided."}}

Rules:
- You MUST pick a protocol from the allowed list only. Do not invent protocol names.
- amount must be a positive integer ≤ min(remainingBudget, maxSingleTx) in MIST.
- Market context is the only source of truth for live yields or protocol health.
  Do not invent current APYs, TVL, risk events, or protocol health.
  If live market data is absent, say so in the reasoning and make a conservative decision.
- If no protocol is attractive or the deployment size is too small to justify gas,
  return kind: "skip" with a clear reason.
- If you propose an action, include your reasoning so the decision is auditable.
```

**Error handling (in priority order):**

1. **Disallowed protocol in response** — `!allowedProtocols.includes(decision.protocol)`:
   - If `throwOnAiFailure`: throw `Error('AI proposed disallowed protocol: <name>')`
   - Otherwise: return `{ kind: 'skip', reason: 'AI proposed disallowed protocol: <name>' }`

2. **Invalid amount** — `amount <= 0` or `amount > min(remainingBudget, maxSingleTx)`:
   - Same: throw or return skip depending on `throwOnAiFailure`

3. **Claude API error / parse error** (caught in try/catch):
   - If `throwOnAiFailure`: rethrow
   - Otherwise: return `{ kind: 'skip', reason: 'AI decision unavailable' }`

Note: `z.number().int().positive()` in the schema catches negative/zero amounts at parse time. The explicit amount-ceiling check (`amount > min(remainingBudget, maxSingleTx)`) must be done post-parse since it depends on runtime state values.

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
  decision = aiDecision
} else {
  // Backward compat: deterministic legacy propose (only when AI not configured).
  // This is the logic previously in decision.ts's propose branch, now inlined here
  // since decision.ts no longer returns propose — only eligible: true/false.
  decision = {
    protocol: state.allowedProtocols[0],
    amount: Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx),
    action: 'supply',
  }
}
// decision flows into existing validateAction → buildActionPtb → submitTransaction
```

**Backward-compat invariant:** the legacy deterministic path runs only when `opts.ai` is absent (deliberate non-configuration). If `opts.ai` is provided but Claude fails, the cycle skips — funds never move without AI judgment when AI was opted into.

**CLI (`policyloop/bin/policyloop.ts`):** reads `ANTHROPIC_API_KEY` env var. If present, constructs an `Anthropic` client and populates `opts.ai`. Reads `POLICYLOOP_MARKET_CONTEXT` env var (optional free-form string) for `marketContext`.

---

## Test Plan

### `decision.test.ts`
All existing tests updated to assert `EligibilityResult` shapes:
- `{ eligible: false, reason: 'policy is paused' }` etc.
- `{ eligible: true }` for the passing case

### `aiDecision.test.ts` (new)
Mock Anthropic client. Cases:
1. Valid propose — Claude returns valid protocol + amount → `{ kind: 'propose', ... }`
2. Valid skip — Claude returns skip with reason → `{ kind: 'skip', reason }`
3. Disallowed protocol, `throwOnAiFailure: false` → skip with reason
4. Disallowed protocol, `throwOnAiFailure: true` → throws
5. Amount above ceiling, `throwOnAiFailure: false` → skip
6. Amount above ceiling, `throwOnAiFailure: true` → throws
7. API error, `throwOnAiFailure: false` → `{ kind: 'skip', reason: 'AI decision unavailable' }`
8. API error, `throwOnAiFailure: true` → rethrows

### `index.test.ts`
Mock `checkEligibility` and `consultDecisionAI`. Cases:
1. Eligibility check returns `eligible: false` → skipped, AI never called
2. `opts.ai` present + AI proposes → validate + build + submit called
3. `opts.ai` present + AI skips → cycle skipped, submit not called
4. No `opts.ai` → legacy deterministic propose used (backward compat)

---

## Open Questions / Future Work

- **Model choice:** spec uses `claude-haiku-4-5` (cheap, fast for autonomous loops). Caller can override.
- **Phase 3 (C):** when trusted market data (oracle/indexer) is available, `marketContext` can be replaced with structured data. No architectural changes needed — `consultDecisionAI` signature is already open.
- **Reasoning logging:** the `reasoning` field on propose decisions is surfaced to the caller via `AiDecision` but not persisted by the policyloop itself. Callers (CLI, daemon) may log it as they see fit.
