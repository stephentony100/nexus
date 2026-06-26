# AI-Driven PolicyLoop Decisions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded `decidePolicyAction` logic in `policyloop` with a Claude strategy call that picks protocol, sizes amount, and can recommend skipping a cycle.

**Architecture:** `decision.ts` becomes a pure eligibility guard (`checkEligibility`); a new `aiDecision.ts` module handles the Claude call with structured output (via `zodOutputFormat`); `index.ts` orchestrates the two modules and maintains a legacy deterministic fallback for callers without an AI client. Claude output is validated twice: immediately post-parse (protocol allowlist, amount ceiling) and again by the existing `validateAction` pipeline.

**Tech Stack:** `@anthropic-ai/sdk@^0.104.2`, `zod@^4.4.3`, Vitest (no typecheck flag), TypeScript ESM (`"type": "module"`, `.js` import extensions)

## Global Constraints

- All TypeScript files use ESM: imports must end in `.js` (e.g., `import { x } from './decision.js'`)
- `vitest run` only — no `--typecheck` flag; `tsc` runs separately in Task 5
- Model: `claude-haiku-4-5-20251001` (cheap, fast for autonomous loops)
- `action: 'supply'` is added by the orchestrator after parsing — never emitted by Claude
- Legacy mode (no `opts.ai`) is backward compat only — NOT a silent fallback after AI failure
- `throwOnAiFailure` controls all AI-contract violations uniformly (disallowed protocol, bad amount, API error)

---

### Task 1: Refactor `decision.ts` — rename to `checkEligibility`, update tests

**Files:**
- Modify: `policyloop/src/decision.ts`
- Modify: `policyloop/src/decision.test.ts`

**Interfaces:**
- Produces: `checkEligibility(state: PolicyState, nowMs: number): EligibilityResult`
- Produces: `type EligibilityResult = { eligible: true } | { eligible: false; reason: string }`
- Removes: `decidePolicyAction`, `PolicyDecision` (no longer exported from this file)

---

- [ ] **Step 1: Replace `decision.ts` with the new implementation**

The function keeps all existing guard checks in the same order. The propose logic is removed entirely — `decision.ts` now only answers "is execution permitted?"

```ts
// policyloop/src/decision.ts
import type { PolicyState } from 'actionflow'

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: string }

export function checkEligibility(state: PolicyState, nowMs: number): EligibilityResult {
  if (state.paused) return { eligible: false, reason: 'policy is paused' }
  if (state.revoked) return { eligible: false, reason: 'policy is revoked' }
  if (nowMs > state.expiresAtMs) return { eligible: false, reason: `policy expired at ${state.expiresAtMs}` }
  if (state.spentTotal >= state.maxTotalBudget) return { eligible: false, reason: 'budget exhausted' }
  if (state.allowedProtocols.length === 0) return { eligible: false, reason: 'no allowed protocols' }
  return { eligible: true }
}
```

- [ ] **Step 2: Replace `decision.test.ts` with tests for the new API**

The propose-specific tests (maxSingleTx cap, remaining budget cap) are removed because `checkEligibility` has no propose logic. All guard-ordering tests are preserved, with result shapes updated to `EligibilityResult`.

```ts
// policyloop/src/decision.test.ts
import { describe, expect, it } from 'vitest'
import type { PolicyState } from 'actionflow'
import { checkEligibility } from './decision.js'

function baseState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0x' + 'aa'.repeat(32),
    maxTotalBudget: 1000,
    spentTotal: 0,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: 2_000_000_000_000,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

describe('checkEligibility', () => {
  it('returns eligible: false when paused', () => {
    expect(checkEligibility(baseState({ paused: true }), 1000)).toEqual({ eligible: false, reason: 'policy is paused' })
  })

  it('returns eligible: false when revoked', () => {
    expect(checkEligibility(baseState({ revoked: true }), 1000)).toEqual({ eligible: false, reason: 'policy is revoked' })
  })

  it('returns eligible: false when expired', () => {
    expect(checkEligibility(baseState({ expiresAtMs: 500 }), 1000)).toEqual({ eligible: false, reason: 'policy expired at 500' })
  })

  it('does not treat nowMs equal to expiresAtMs as expired', () => {
    expect(checkEligibility(baseState({ expiresAtMs: 1000 }), 1000)).toEqual({ eligible: true })
  })

  it('returns eligible: false when budget is exhausted', () => {
    expect(checkEligibility(baseState({ spentTotal: 1000, maxTotalBudget: 1000 }), 1000)).toEqual({
      eligible: false,
      reason: 'budget exhausted',
    })
  })

  it('returns eligible: false when there are no allowed protocols', () => {
    expect(checkEligibility(baseState({ allowedProtocols: [] }), 1000)).toEqual({
      eligible: false,
      reason: 'no allowed protocols',
    })
  })

  it('returns eligible: true when all checks pass', () => {
    expect(checkEligibility(baseState(), 1000)).toEqual({ eligible: true })
  })

  it('checks paused before revoked, expiry, and budget', () => {
    const state = baseState({ paused: true, revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'policy is paused' })
  })

  it('checks revoked before expiry and budget', () => {
    const state = baseState({ revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'policy is revoked' })
  })

  it('checks expiry before budget exhaustion', () => {
    const state = baseState({ expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'policy expired at 0' })
  })

  it('checks budget exhaustion before empty allowed protocols', () => {
    const state = baseState({ spentTotal: 1000, maxTotalBudget: 1000, allowedProtocols: [] })
    expect(checkEligibility(state, 1000)).toEqual({ eligible: false, reason: 'budget exhausted' })
  })
})
```

- [ ] **Step 3: Run the decision tests to verify they pass**

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: 11 tests pass in `decision.test.ts`. The `index.test.ts` suite will fail (it still imports the old `decidePolicyAction`) — this is expected and is fixed in Task 3.

- [ ] **Step 4: Commit**

```bash
git add policyloop/src/decision.ts policyloop/src/decision.test.ts
git commit -m "refactor(policyloop): rename decidePolicyAction to checkEligibility"
```

---

### Task 2: Add SDK dependencies, create `aiDecision.ts` and `aiDecision.test.ts`

**Files:**
- Modify: `policyloop/package.json`
- Create: `policyloop/src/aiDecision.ts`
- Create: `policyloop/src/aiDecision.test.ts`

**Interfaces:**
- Consumes: `checkEligibility`, `EligibilityResult` from Task 1
- Produces: `consultDecisionAI(state: PolicyState, client: Anthropic, options?: { marketContext?: string; throwOnAiFailure?: boolean }): Promise<AiDecision>`
- Produces: `type AiDecision = { kind: 'skip'; reason: string; errorType?: 'rate_limit' | 'network' | 'parse' | 'unknown' } | { kind: 'propose'; protocol: string; amount: number; reasoning: string }`

---

- [ ] **Step 1: Add `@anthropic-ai/sdk` and `zod` to `policyloop/package.json`**

```json
{
  "name": "policyloop",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "cli": "tsx bin/policyloop.ts"
  },
  "dependencies": {
    "actionflow": "file:../actionflow",
    "agentrunner": "file:../agentrunner",
    "@anthropic-ai/sdk": "^0.104.2",
    "@mysten/sui": "^2.18.0",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.3",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Install the new dependencies**

```
cd policyloop && npm install
```

Expected: `package-lock.json` updated, no errors.

- [ ] **Step 3: Write the failing tests for `aiDecision.ts`**

The tests pass a fake `Anthropic` client object directly — no `vi.mock('@anthropic-ai/sdk')` needed, because `consultDecisionAI` receives `client` as a parameter. The `makeClient` helper constructs the fake client with a pre-resolved `parse` mock.

```ts
// policyloop/src/aiDecision.test.ts
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
})
```

- [ ] **Step 4: Run the tests to confirm they fail** (module does not exist yet)

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: 8 tests in `aiDecision.test.ts` fail with "Cannot find module './aiDecision.js'". The `decision.test.ts` suite continues passing.

- [ ] **Step 5: Create `aiDecision.ts`**

`AiDecision` type adds `errorType` on AI-failure skips; the `action` field is intentionally absent from `AiDecisionSchema` — `action: 'supply'` is added by the orchestrator so Claude cannot emit an unsupported action type.

```ts
// policyloop/src/aiDecision.ts
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
```

- [ ] **Step 6: Run the tests to verify all 8 `aiDecision` tests pass**

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: 11 `decision.test.ts` + 8 `aiDecision.test.ts` = 19 tests pass. `index.test.ts` still failing (fixed in Task 3).

- [ ] **Step 7: Commit**

```bash
git add policyloop/package.json policyloop/package-lock.json policyloop/src/aiDecision.ts policyloop/src/aiDecision.test.ts
git commit -m "feat(policyloop): add aiDecision module with Claude strategy and structured output"
```

---

### Task 3: Rewrite `index.ts` and `index.test.ts`

**Files:**
- Modify: `policyloop/src/index.ts`
- Modify: `policyloop/src/index.test.ts`

**Interfaces:**
- Consumes: `checkEligibility`, `EligibilityResult` from `./decision.js` (Task 1)
- Consumes: `consultDecisionAI`, `AiDecision` from `./aiDecision.js` (Task 2)
- Produces: `runPolicyCycle(opts: PolicyLoopOptions): Promise<PolicyLoopResult>`
- Produces (re-exported): `checkEligibility`, `EligibilityResult`, `consultDecisionAI`, `AiDecision`
- Removes: re-export of `decidePolicyAction` and `PolicyDecision`

---

- [ ] **Step 1: Write the new `index.test.ts`**

Mocks are added for `./decision.js` and `./aiDecision.js`. A `beforeEach` clears all mocks between tests. The 4 existing test cases are replaced with 6 tests covering the AI path, AI skip, eligibility fail, legacy mode, validation failure, and config missing.

```ts
// policyloop/src/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyState } from 'actionflow'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('actionflow', () => ({
  fetchPolicyState: vi.fn(),
  validateAction: vi.fn(),
  buildActionPtb: vi.fn(),
}))

vi.mock('agentrunner', () => ({
  loadAgentKeypair: vi.fn(),
  submitTransaction: vi.fn(),
}))

vi.mock('./decision.js', () => ({
  checkEligibility: vi.fn(),
}))

vi.mock('./aiDecision.js', () => ({
  consultDecisionAI: vi.fn(),
}))

import { fetchPolicyState, validateAction, buildActionPtb } from 'actionflow'
import { submitTransaction } from 'agentrunner'
import { checkEligibility } from './decision.js'
import { consultDecisionAI } from './aiDecision.js'
import { runPolicyCycle } from './index.js'

const POLICY_ID = '0x' + 'aa'.repeat(32)
const PACKAGE_ID = '0x' + '11'.repeat(32)

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

describe('runPolicyCycle', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns skipped without calling AI or validateAction when eligibility check fails', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState({ paused: true }))
    vi.mocked(checkEligibility).mockReturnValue({ eligible: false, reason: 'policy is paused' })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
    })

    expect(result).toEqual({ ok: true, status: 'skipped', reason: 'policy is paused' })
    expect(consultDecisionAI).not.toHaveBeenCalled()
    expect(validateAction).not.toHaveBeenCalled()
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('calls consultDecisionAI and submits when opts.ai is set and AI proposes', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(consultDecisionAI).mockResolvedValue({
      kind: 'propose',
      protocol: 'scallop',
      amount: 75,
      reasoning: 'good yield',
    })
    vi.mocked(validateAction).mockReturnValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 75, action: 'supply' },
    })
    vi.mocked(buildActionPtb).mockReturnValue({ ok: true, tx: new Transaction() })
    vi.mocked(submitTransaction).mockResolvedValue({
      ok: true,
      status: 'succeeded',
      digest: 'digest1',
      eventKind: 'action_recorded',
      event: {
        policyId: POLICY_ID,
        agent: signer.toSuiAddress(),
        protocolId: 'scallop',
        amount: '75',
        spentTotal: '75',
        walrusBlobId: 'blob',
        timestampMs: '1700000000000',
      },
    })

    const fakeClient = {} as Anthropic
    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
      ai: { client: fakeClient },
    })

    expect(result.ok).toBe(true)
    expect(consultDecisionAI).toHaveBeenCalledWith(
      expect.objectContaining({ allowedProtocols: ['scallop'] }),
      fakeClient,
      { marketContext: undefined, throwOnAiFailure: undefined },
    )
    expect(validateAction).toHaveBeenCalledWith(
      { protocol: 'scallop', amount: 75, action: 'supply' },
      expect.any(Object),
      expect.any(Number),
      POLICY_ID,
    )
    expect(submitTransaction).toHaveBeenCalledTimes(1)
  })

  it('returns skipped without calling validateAction when opts.ai is set and AI returns skip', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(consultDecisionAI).mockResolvedValue({ kind: 'skip', reason: 'no good opportunities' })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
      ai: { client: {} as Anthropic },
    })

    expect(result).toEqual({ ok: true, status: 'skipped', reason: 'no good opportunities' })
    expect(validateAction).not.toHaveBeenCalled()
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('uses legacy deterministic propose when opts.ai is not set', async () => {
    const signer = Ed25519Keypair.generate()
    const state = basePolicyState({ maxTotalBudget: 1000, spentTotal: 0, maxSingleTx: 100 })
    vi.mocked(fetchPolicyState).mockResolvedValue(state)
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(validateAction).mockReturnValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' },
    })
    vi.mocked(buildActionPtb).mockReturnValue({ ok: true, tx: new Transaction() })
    vi.mocked(submitTransaction).mockResolvedValue({
      ok: true,
      status: 'succeeded',
      digest: 'digest1',
      eventKind: 'action_recorded',
      event: {
        policyId: POLICY_ID,
        agent: signer.toSuiAddress(),
        protocolId: 'scallop',
        amount: '100',
        spentTotal: '100',
        walrusBlobId: 'blob',
        timestampMs: '1700000000000',
      },
    })

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
    })

    expect(result.ok).toBe(true)
    expect(consultDecisionAI).not.toHaveBeenCalled()
    expect(validateAction).toHaveBeenCalledWith(
      { protocol: 'scallop', amount: 100, action: 'supply' },
      expect.any(Object),
      expect.any(Number),
      POLICY_ID,
    )
    expect(buildActionPtb).toHaveBeenCalledWith(
      { policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' },
      'blob',
      PACKAGE_ID,
      undefined,
    )
    expect(submitTransaction).toHaveBeenCalledTimes(1)
    const [calledTx, calledSigner] = vi.mocked(submitTransaction).mock.calls[0]
    expect(calledSigner).toBe(signer)
    expect(calledTx.getData().sender).toBe(signer.toSuiAddress())
  })

  it('returns validation_failed when validateAction rejects the proposed action', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(validateAction).mockReturnValue({
      ok: false,
      errors: [{ field: 'amount', reason: 'amount (100) exceeds maxSingleTx (50)' }],
    })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
    })

    expect(result).toEqual({
      ok: false,
      status: 'validation_failed',
      errors: [{ field: 'amount', reason: 'amount (100) exceeds maxSingleTx (50)' }],
    })
    expect(buildActionPtb).not.toHaveBeenCalled()
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('returns config_missing when buildActionPtb cannot route the action', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(validateAction).mockReturnValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' },
    })
    vi.mocked(buildActionPtb).mockReturnValue({
      ok: false,
      status: 'config_missing',
      reason: 'scallop config required for scallop supply',
    })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
    })

    expect(result).toEqual({
      ok: false,
      status: 'config_missing',
      reason: 'scallop config required for scallop supply',
    })
    expect(submitTransaction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm `index.test.ts` fails** (index.ts still has old imports)

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: `index.test.ts` tests fail. `decision.test.ts` and `aiDecision.test.ts` continue passing.

- [ ] **Step 3: Replace `index.ts` with the new orchestration**

```ts
// policyloop/src/index.ts
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type Anthropic from '@anthropic-ai/sdk'
import { fetchPolicyState, validateAction, buildActionPtb } from 'actionflow'
import type { ScallopConfig } from 'actionflow'
import { loadAgentKeypair, submitTransaction } from 'agentrunner'
import type { RunActionResult } from 'agentrunner'
import { checkEligibility } from './decision.js'
import { consultDecisionAI } from './aiDecision.js'

export interface PolicyLoopOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  scallop?: ScallopConfig
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
  ai?: {
    client: Anthropic
    marketContext?: string
    throwOnAiFailure?: boolean
  }
}

export type PolicyLoopResult =
  | { ok: true; status: 'skipped'; reason: string }
  | RunActionResult

export async function runPolicyCycle(opts: PolicyLoopOptions): Promise<PolicyLoopResult> {
  const suiClient =
    opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })
  const nowMs = Date.now()

  const state = await fetchPolicyState(opts.policyId, suiClient)

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
    decision = { protocol: aiDecision.protocol, amount: aiDecision.amount, action: 'supply' }
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

  const validated = validateAction(
    { protocol: decision.protocol, amount: decision.amount, action: decision.action },
    state,
    nowMs,
    opts.policyId,
  )
  if (!validated.ok) {
    return { ok: false, status: 'validation_failed', errors: validated.errors }
  }

  const built = buildActionPtb(validated.action, opts.walrusBlobId, opts.packageId, opts.scallop)
  if (!built.ok) {
    return built
  }

  const signer = opts.signer ?? loadAgentKeypair()
  built.tx.setSender(signer.toSuiAddress())

  return submitTransaction(built.tx, signer, suiClient)
}

export { checkEligibility } from './decision.js'
export type { EligibilityResult } from './decision.js'
export { consultDecisionAI } from './aiDecision.js'
export type { AiDecision } from './aiDecision.js'
```

- [ ] **Step 4: Run the full test suite**

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: 11 + 8 + 6 = 25 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add policyloop/src/index.ts policyloop/src/index.test.ts
git commit -m "feat(policyloop): wire AI decision path into runPolicyCycle orchestration"
```

---

### Task 4: Update CLI to read AI config from environment

**Files:**
- Modify: `policyloop/bin/policyloop.ts`

**Interfaces:**
- Consumes: `runPolicyCycle` with new `ai?` option from Task 3

---

- [ ] **Step 1: Replace `policyloop/bin/policyloop.ts`**

`readAiConfig` reads three env vars: `ANTHROPIC_API_KEY` (required to enable AI mode), `POLICYLOOP_MARKET_CONTEXT` (optional free-form string injected as Claude's sole market data source), and `POLICYLOOP_THROW_ON_AI_FAILURE=true` (dev-mode flag that propagates AI errors instead of skipping).

```ts
#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk'
import { runPolicyCycle } from '../src/index.js'

function readScallopConfig() {
  const versionObjectId = process.env.SCALLOP_VERSION_OBJECT_ID
  const marketObjectId = process.env.SCALLOP_MARKET_OBJECT_ID
  if (!versionObjectId || !marketObjectId) {
    return undefined
  }
  return {
    versionObjectId,
    marketObjectId,
    versionInitialSharedVersion: process.env.SCALLOP_VERSION_INITIAL_SHARED_VERSION,
    marketInitialSharedVersion: process.env.SCALLOP_MARKET_INITIAL_SHARED_VERSION,
  }
}

function readAiConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — running in legacy (deterministic) mode')
    return undefined
  }
  return {
    client: new Anthropic({ apiKey }),
    marketContext: process.env.POLICYLOOP_MARKET_CONTEXT,
    throwOnAiFailure: process.env.POLICYLOOP_THROW_ON_AI_FAILURE === 'true',
  }
}

async function main() {
  const policyId = process.env.ACTIONFLOW_POLICY_ID
  if (!policyId) {
    console.error('Missing ACTIONFLOW_POLICY_ID environment variable')
    process.exit(1)
  }

  const packageId = process.env.ACTIONFLOW_PACKAGE_ID
  if (!packageId) {
    console.error('Missing ACTIONFLOW_PACKAGE_ID environment variable')
    process.exit(1)
  }

  const walrusBlobId = process.env.ACTIONFLOW_WALRUS_BLOB_ID
  if (!walrusBlobId) {
    console.error('Missing ACTIONFLOW_WALRUS_BLOB_ID environment variable')
    process.exit(1)
  }

  if (!process.env.AGENTRUNNER_PRIVATE_KEY) {
    console.error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
    process.exit(1)
  }

  const result = await runPolicyCycle({
    policyId,
    packageId,
    walrusBlobId,
    scallop: readScallopConfig(),
    ai: readAiConfig(),
  })

  switch (result.status) {
    case 'skipped':
      console.log(`Skipped: ${result.reason}`)
      return
    case 'succeeded':
      console.log(result.eventKind === 'scallop_sui_supplied' ? 'Scallop SUI supply recorded on-chain:' : 'Action recorded on-chain:')
      console.log(JSON.stringify(result.event, null, 2))
      console.log(`\nDigest: ${result.digest}`)
      return
    case 'validation_failed':
      console.error('Decided action failed validation:')
      for (const error of result.errors) {
        console.error(`  - ${error.field}: ${error.reason}`)
      }
      process.exit(1)
      return
    case 'config_missing':
      console.error(`Missing configuration: ${result.reason}`)
      process.exit(1)
      return
    case 'simulation_failed':
      console.error(`Simulation rejected this action: ${result.reason}`)
      process.exit(1)
      return
    case 'execution_aborted':
      console.error(`Execution aborted on-chain (digest ${result.digest}): ${result.reason}`)
      process.exit(1)
      return
    case 'event_missing':
      console.error(`Execution reported success (digest ${result.digest}) but no recognized event was found`)
      process.exit(1)
      return
    case 'submission_failed':
      console.error(`Submission failed during ${result.stage}: ${result.reason}`)
      process.exit(1)
      return
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
```

- [ ] **Step 2: Run the full test suite to confirm nothing regressed**

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: 25 tests pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add policyloop/bin/policyloop.ts
git commit -m "feat(policyloop): read ANTHROPIC_API_KEY and market context from env in CLI"
```

---

### Task 5: Final verification — full test run and build

**Files:** No code changes.

---

- [ ] **Step 1: Run the full test suite one final time**

```
cd policyloop && npm test -- --reporter=verbose
```

Expected: 25 tests pass, 0 fail.

- [ ] **Step 2: Run the TypeScript build**

```
cd policyloop && npm run build
```

Expected: `tsc` exits 0, no errors. Output files in `dist/`.

- [ ] **Step 3: Verify the dist exports are present**

```
node -e "import('./dist/src/index.js').then(m => console.log(Object.keys(m)))"
```

Expected output includes: `runPolicyCycle`, `checkEligibility`, `consultDecisionAI` (and their type-only counterparts won't appear at runtime but the dist file should exist without error).

- [ ] **Step 4: Push the branch**

```bash
git push origin main
```

(Or push to your feature branch if working in a worktree. The user handles PR creation.)
