# ActionFlow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `actionflow/`, a TypeScript package that translates a plain-English action goal (e.g. "deposit 100 into scallop") into a validated action and an unsigned Sui PTB calling `nexus_agent_wallet::policy::record_action`.

**Architecture:** A 4-stage pipeline — Extractor (Claude structured output) → State Fetcher (live `SuiClient.getObject` read of the on-chain `PolicyObject`) → Validator (pure function replicating `record_action`'s on-chain assertions against the live state) → PTB Builder (`@mysten/sui` `Transaction`) — composed by `translateAction()` and exposed via a thin CLI. No signing, no submission, no real protocol calls.

**Tech Stack:** TypeScript (NodeNext ESM), `@anthropic-ai/sdk` (structured outputs via `zodOutputFormat`), `@mysten/sui` (`SuiClient`, `Transaction`), `zod`, `vitest`, `tsx` for the CLI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-actionflow-design.md` — follow exactly; this plan implements that design.
- New standalone package `actionflow/`, sibling to `intentflow/` and `nexus_agent_wallet/`. Mirror `intentflow/`'s package layout and tooling versions exactly (see Task 1).
- No signing, wallet integration, zkLogin, or network submission. PTBs are built and returned as serialized bytes only (`tx.build({ onlyTransactionKind: true })`).
- No real Scallop/DeepBook protocol calls and no real Walrus storage — `walrusBlobId` is an opaque caller-supplied placeholder string, never generated or validated by this library.
- The validator must replicate `record_action`'s exact checks and order, **except** the `assert_agent` (sender == `policy.agent`) check, which cannot be done locally without a signer. This is a deliberate, documented gap (see Task 4) — not a bug to "fix."
- Every user-input failure (missing field, business-rule violation) is a typed `FieldError` result, never a thrown exception. Genuine infra failures (Claude API errors, `PolicyFetchError`) propagate as exceptions to the caller.
- Test runner: `vitest`. No real network calls in any test — `Anthropic` and `SuiClient` are always mocked.

---

## File Structure

```
actionflow/
  package.json
  tsconfig.json
  vitest.config.ts
  bin/
    actionflow.ts
  src/
    types.ts
    extractor.ts
    extractor.test.ts
    policyState.ts
    policyState.test.ts
    validator.ts
    validator.test.ts
    ptbBuilder.ts
    ptbBuilder.test.ts
    index.ts
    index.test.ts
  README.md
```

---

### Task 1: Package scaffolding and shared types

**Files:**
- Create: `actionflow/package.json`
- Create: `actionflow/tsconfig.json`
- Create: `actionflow/vitest.config.ts`
- Create: `actionflow/src/types.ts`

**Interfaces:**
- Produces: `PolicyState`, `PolicyAction`, `FieldError`, `ValidationResult`, `TranslateActionResult` — used by every later task.

- [ ] **Step 1: Create `actionflow/package.json`**

```json
{
  "name": "actionflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "cli": "tsx bin/actionflow.ts"
  },
  "dependencies": {
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

- [ ] **Step 2: Create `actionflow/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src/**/*.ts", "bin/**/*.ts"]
}
```

- [ ] **Step 3: Create `actionflow/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Install dependencies**

Run: `cd actionflow && npm install`
Expected: completes with no errors, creates `actionflow/node_modules` and `actionflow/package-lock.json`.

- [ ] **Step 5: Create `actionflow/src/types.ts`**

```typescript
export interface PolicyState {
  agent: string
  maxTotalBudget: number
  spentTotal: number
  maxSingleTx: number
  allowedProtocols: string[]
  expiresAtMs: number
  paused: boolean
  revoked: boolean
}

export interface PolicyAction {
  policyId: string
  protocol: string
  amount: number
}

export interface FieldError {
  field: string
  reason: string
}

export type ValidationResult =
  | { ok: true; action: PolicyAction }
  | { ok: false; errors: FieldError[] }

export type TranslateActionResult =
  | { ok: true; action: PolicyAction; ptbBytes: string }
  | { ok: false; errors: FieldError[] }
```

- [ ] **Step 6: Verify the package builds**

Run: `cd actionflow && npm run build`
Expected: exits 0, no TypeScript errors, produces `actionflow/dist/src/types.js` and `actionflow/dist/src/types.d.ts`.

- [ ] **Step 7: Verify the (currently empty) test suite runs**

Run: `cd actionflow && npm test`
Expected: vitest exits 0 (no test files yet is fine — this just confirms the toolchain is wired up).

- [ ] **Step 8: Commit**

```bash
git add actionflow/package.json actionflow/package-lock.json actionflow/tsconfig.json actionflow/vitest.config.ts actionflow/src/types.ts
git commit -m "actionflow: scaffold package and shared types"
```

---

### Task 2: Extractor

**Files:**
- Create: `actionflow/src/extractor.ts`
- Test: `actionflow/src/extractor.test.ts`

**Interfaces:**
- Consumes: nothing from other ActionFlow modules.
- Produces: `RawActionGoal` (`{ protocol: string | null; amount: number | null }`), `extractActionGoal(goal: string, client: Anthropic): Promise<RawActionGoal>`, `ExtractionRefusedError` — all consumed by Task 6 (`index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `actionflow/src/extractor.test.ts`:

```typescript
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
      parsed_output: { protocol: 'scallop', amount: 100 },
    })

    const result = await extractActionGoal('deposit $100 into scallop', client)

    expect(result).toEqual({ protocol: 'scallop', amount: 100 })
  })

  it('returns all-null fields when the goal has nothing to extract', async () => {
    const client = mockClient({
      stop_reason: 'end_turn',
      parsed_output: { protocol: null, amount: null },
    })

    const result = await extractActionGoal('what is the weather today?', client)

    expect(result.protocol).toBeNull()
    expect(result.amount).toBeNull()
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd actionflow && npx vitest run src/extractor.test.ts`
Expected: FAIL — `extractor.ts` does not exist yet (`Cannot find module './extractor.js'`).

- [ ] **Step 3: Write the implementation**

Create `actionflow/src/extractor.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd actionflow && npx vitest run src/extractor.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add actionflow/src/extractor.ts actionflow/src/extractor.test.ts
git commit -m "actionflow: add Claude-based action goal extractor"
```

---

### Task 3: Live PolicyObject state fetcher

**Files:**
- Create: `actionflow/src/policyState.ts`
- Test: `actionflow/src/policyState.test.ts`

**Interfaces:**
- Consumes: `PolicyState` from `actionflow/src/types.ts` (Task 1).
- Produces: `fetchPolicyState(policyId: string, client: SuiClient): Promise<PolicyState>`, `PolicyFetchError` — both consumed by Task 6 (`index.ts`).

**Note on field decoding:** the Sui JSON-RPC represents Move `u64` fields as numeric strings and `vector<u8>` fields as arrays of byte numbers in `content.fields` when `showContent: true` is requested. The implementation below decodes accordingly. Before writing Step 3, run `cd actionflow && npx tsc --noEmit -p . 2>&1 | head -50` is not useful yet (no usage); instead inspect the installed type declarations directly: open `actionflow/node_modules/@mysten/sui/dist/cjs/client/types/generated.d.ts` (or the `.ts` source if present) and search for `MoveObjectContent` / `SuiParsedData` to confirm the `content.fields` shape matches what's assumed here. If the installed SDK's shape differs, adjust the parsing code in Step 3 accordingly — the test in Step 1 is what must keep passing, not the exact line-for-line code below.

- [ ] **Step 1: Write the failing tests**

Create `actionflow/src/policyState.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import type { SuiClient } from '@mysten/sui/client'
import { fetchPolicyState, PolicyFetchError } from './policyState.js'

function mockClient(getObjectResult: unknown): SuiClient {
  return {
    getObject: vi.fn().mockResolvedValue(getObjectResult),
  } as unknown as SuiClient
}

function scallopBytes(): number[] {
  return Array.from(new TextEncoder().encode('scallop'))
}

describe('fetchPolicyState', () => {
  it('parses a well-formed PolicyObject response', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    const state = await fetchPolicyState('0xpolicy', client)

    expect(state).toEqual({
      agent: '0xagent',
      maxTotalBudget: 500,
      spentTotal: 100,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresAtMs: 1700000000000,
      paused: false,
      revoked: false,
    })
  })

  it('throws PolicyFetchError when content is missing', async () => {
    const client = mockClient({ data: { objectId: '0xpolicy' } })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when allowed_protocols is malformed', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd actionflow && npx vitest run src/policyState.test.ts`
Expected: FAIL — `policyState.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `actionflow/src/policyState.ts`:

```typescript
import type { SuiClient } from '@mysten/sui/client'
import type { PolicyState } from './types.js'

export class PolicyFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyFetchError'
  }
}

export async function fetchPolicyState(policyId: string, client: SuiClient): Promise<PolicyState> {
  const response = await client.getObject({ id: policyId, options: { showContent: true } })

  const content = response.data?.content
  if (!content || content.dataType !== 'moveObject') {
    throw new PolicyFetchError(`Object ${policyId} is not a PolicyObject (missing or non-Move content)`)
  }

  const fields = content.fields as Record<string, unknown>

  const allowedProtocolsRaw = fields.allowed_protocols
  if (!Array.isArray(allowedProtocolsRaw)) {
    throw new PolicyFetchError(`Object ${policyId} is missing allowed_protocols field`)
  }
  const allowedProtocols = allowedProtocolsRaw.map((bytes) => {
    if (!Array.isArray(bytes)) {
      throw new PolicyFetchError(`Object ${policyId} has a malformed allowed_protocols entry`)
    }
    return Buffer.from(bytes as number[]).toString('utf8')
  })

  return {
    agent: String(fields.agent),
    maxTotalBudget: Number(fields.max_total_budget),
    spentTotal: Number(fields.spent_total),
    maxSingleTx: Number(fields.max_single_tx),
    allowedProtocols,
    expiresAtMs: Number(fields.expires_at_ms),
    paused: Boolean(fields.paused),
    revoked: Boolean(fields.revoked),
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd actionflow && npx vitest run src/policyState.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add actionflow/src/policyState.ts actionflow/src/policyState.test.ts
git commit -m "actionflow: add live PolicyObject state fetcher"
```

---

### Task 4: Validator

**Files:**
- Create: `actionflow/src/validator.ts`
- Test: `actionflow/src/validator.test.ts`

**Interfaces:**
- Consumes: `RawActionGoal` (Task 2), `PolicyState`, `PolicyAction`, `FieldError`, `ValidationResult` (Task 1).
- Produces: `validateAction(raw: RawActionGoal, state: PolicyState, nowMs: number, policyId: string): ValidationResult` — consumed by Task 6 (`index.ts`).

This re-implements `nexus_agent_wallet::policy::record_action`'s checks (`nexus_agent_wallet/sources/policy.move:160-189`) in the same order, **except** `assert_agent` (sender == `policy.agent`), which cannot be checked without a signer — see the design's Architecture caveat. Errors for paused/revoked/expired use `field: '_root'` since they aren't tied to a single input field; protocol/amount errors use the relevant field name.

- [ ] **Step 1: Write the failing tests**

Create `actionflow/src/validator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { validateAction } from './validator.js'
import type { RawActionGoal } from './extractor.js'
import type { PolicyState } from './types.js'

const NOW = 1_700_000_000_000
const POLICY_ID = '0xpolicy'

function validRaw(overrides: Partial<RawActionGoal> = {}): RawActionGoal {
  return {
    protocol: 'scallop',
    amount: 100,
    ...overrides,
  }
}

function validState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0xagent',
    maxTotalBudget: 500,
    spentTotal: 100,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: NOW + 1_000_000,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

describe('validateAction', () => {
  it('accepts a fully valid action', () => {
    const result = validateAction(validRaw(), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action).toEqual({ policyId: POLICY_ID, protocol: 'scallop', amount: 100 })
    }
  })

  it('accepts amount equal to maxSingleTx (boundary)', () => {
    const result = validateAction(validRaw({ amount: 100 }), validState({ maxSingleTx: 100 }), NOW, POLICY_ID)
    expect(result.ok).toBe(true)
  })

  it('accepts spentTotal + amount equal to maxTotalBudget (boundary)', () => {
    const result = validateAction(
      validRaw({ amount: 400 }),
      validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 400 }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a paused policy', () => {
    const result = validateAction(validRaw(), validState({ paused: true }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: '_root', reason: 'policy is paused' })
    }
  })

  it('rejects a revoked policy', () => {
    const result = validateAction(validRaw(), validState({ revoked: true }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: '_root', reason: 'policy is revoked' })
    }
  })

  it('rejects an expired policy', () => {
    const result = validateAction(validRaw(), validState({ expiresAtMs: NOW - 1 }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: '_root', reason: `policy expired at ${NOW - 1}` })
    }
  })

  it('rejects a protocol not in allowedProtocols', () => {
    const result = validateAction(validRaw({ protocol: 'deepbook' }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'protocol',
        reason: '"deepbook" is not in allowed protocols (scallop)',
      })
    }
  })

  it('rejects a null amount', () => {
    const result = validateAction(validRaw({ amount: null }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'amount', reason: 'not specified in goal' })
    }
  })

  it('rejects a non-positive amount', () => {
    const result = validateAction(validRaw({ amount: 0 }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'amount', reason: 'must be greater than 0, got 0' })
    }
  })

  it('rejects an amount over maxSingleTx', () => {
    const result = validateAction(validRaw({ amount: 150 }), validState({ maxSingleTx: 100 }), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'amount',
        reason: 'amount (150) exceeds maxSingleTx (100)',
      })
    }
  })

  it('rejects an amount that exceeds remaining budget', () => {
    const result = validateAction(
      validRaw({ amount: 450 }),
      validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 500 }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'amount',
        reason: 'spentTotal (100) + amount (450) exceeds maxTotalBudget (500)',
      })
    }
  })

  it('rejects a null protocol and null amount together', () => {
    const result = validateAction(validRaw({ protocol: null, amount: null }), validState(), NOW, POLICY_ID)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(2)
      expect(result.errors.map((e) => e.field).sort()).toEqual(['amount', 'protocol'])
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd actionflow && npx vitest run src/validator.test.ts`
Expected: FAIL — `validator.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `actionflow/src/validator.ts`:

```typescript
import type { RawActionGoal } from './extractor.js'
import type { FieldError, PolicyAction, PolicyState, ValidationResult } from './types.js'

export function validateAction(
  raw: RawActionGoal,
  state: PolicyState,
  nowMs: number,
  policyId: string,
): ValidationResult {
  const errors: FieldError[] = []

  if (raw.protocol === null) {
    errors.push({ field: 'protocol', reason: 'not specified in goal' })
  }
  if (raw.amount === null) {
    errors.push({ field: 'amount', reason: 'not specified in goal' })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const protocol = raw.protocol as string
  const amount = raw.amount as number

  if (state.paused) {
    errors.push({ field: '_root', reason: 'policy is paused' })
  }
  if (state.revoked) {
    errors.push({ field: '_root', reason: 'policy is revoked' })
  }
  if (nowMs > state.expiresAtMs) {
    errors.push({ field: '_root', reason: `policy expired at ${state.expiresAtMs}` })
  }
  if (!state.allowedProtocols.includes(protocol)) {
    errors.push({
      field: 'protocol',
      reason: `"${protocol}" is not in allowed protocols (${state.allowedProtocols.join(', ')})`,
    })
  }
  if (amount <= 0) {
    errors.push({ field: 'amount', reason: `must be greater than 0, got ${amount}` })
  } else if (amount > state.maxSingleTx) {
    errors.push({ field: 'amount', reason: `amount (${amount}) exceeds maxSingleTx (${state.maxSingleTx})` })
  } else if (state.spentTotal + amount > state.maxTotalBudget) {
    errors.push({
      field: 'amount',
      reason: `spentTotal (${state.spentTotal}) + amount (${amount}) exceeds maxTotalBudget (${state.maxTotalBudget})`,
    })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const action: PolicyAction = { policyId, protocol, amount }
  return { ok: true, action }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd actionflow && npx vitest run src/validator.test.ts`
Expected: PASS (12/12).

- [ ] **Step 5: Commit**

```bash
git add actionflow/src/validator.ts actionflow/src/validator.test.ts
git commit -m "actionflow: add validator mirroring record_action's on-chain checks"
```

---

### Task 5: PTB Builder

**Files:**
- Create: `actionflow/src/ptbBuilder.ts`
- Test: `actionflow/src/ptbBuilder.test.ts`

**Interfaces:**
- Consumes: `PolicyAction` (Task 1).
- Produces: `buildRecordActionPtb(action: PolicyAction, walrusBlobId: string, packageId: string): Transaction` — consumed by Task 6 (`index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `actionflow/src/ptbBuilder.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildRecordActionPtb } from './ptbBuilder.js'
import type { PolicyAction } from './types.js'

const ACTION: PolicyAction = {
  policyId: '0x' + 'aa'.repeat(32),
  protocol: 'scallop',
  amount: 100,
}

const WALRUS_BLOB_ID = 'placeholder-blob-id'
const PACKAGE_ID = '0x' + '11'.repeat(32)

describe('buildRecordActionPtb', () => {
  it('adds exactly one moveCall targeting policy::record_action', () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
    const data = tx.getData()
    const moveCalls = data.commands.filter(
      (c): c is { $kind: 'MoveCall'; MoveCall: { package: string; module: string; function: string; arguments: unknown[] } } =>
        c.$kind === 'MoveCall',
    )

    expect(moveCalls).toHaveLength(1)
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('record_action')
    expect(call.arguments).toHaveLength(5)
  })

  it('builds to bytes without requiring a network client', async () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd actionflow && npx vitest run src/ptbBuilder.test.ts`
Expected: FAIL — `ptbBuilder.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `actionflow/src/ptbBuilder.ts`:

```typescript
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyAction } from './types.js'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SUI_CLOCK_INITIAL_SHARED_VERSION = 1

export function buildRecordActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
): Transaction {
  const tx = new Transaction()

  tx.moveCall({
    target: `${packageId}::policy::record_action`,
    arguments: [
      tx.object(action.policyId),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(action.protocol))),
      tx.pure.u64(action.amount),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(walrusBlobId))),
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd actionflow && npx vitest run src/ptbBuilder.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add actionflow/src/ptbBuilder.ts actionflow/src/ptbBuilder.test.ts
git commit -m "actionflow: add record_action PTB builder"
```

---

### Task 6: Compose translateAction

**Files:**
- Create: `actionflow/src/index.ts`
- Test: `actionflow/src/index.test.ts`

**Interfaces:**
- Consumes: `extractActionGoal`, `ExtractionRefusedError`, `RawActionGoal` (Task 2); `fetchPolicyState`, `PolicyFetchError` (Task 3); `validateAction` (Task 4); `buildRecordActionPtb` (Task 5); `TranslateActionResult` (Task 1).
- Produces: `translateAction(goal: string, opts: TranslateActionOptions): Promise<TranslateActionResult>` — consumed by Task 7 (CLI).

- [ ] **Step 1: Write the failing tests**

Create `actionflow/src/index.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import type { SuiClient } from '@mysten/sui/client'
import type { PolicyState } from './types.js'

vi.mock('./extractor.js', () => ({
  extractActionGoal: vi.fn(),
  ExtractionRefusedError: class ExtractionRefusedError extends Error {},
}))

vi.mock('./policyState.js', () => ({
  fetchPolicyState: vi.fn(),
  PolicyFetchError: class PolicyFetchError extends Error {},
}))

import { extractActionGoal } from './extractor.js'
import { fetchPolicyState } from './policyState.js'
import { translateAction } from './index.js'

const POLICY_ID = '0x' + 'aa'.repeat(32)
const PACKAGE_ID = '0x' + '11'.repeat(32)

function validState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0x' + 'bb'.repeat(32),
    maxTotalBudget: 500,
    spentTotal: 100,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: Date.now() + 1_000_000,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

describe('translateAction', () => {
  it('returns action and ptbBytes on a full happy path', async () => {
    vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 50 })
    vi.mocked(fetchPolicyState).mockResolvedValue(validState())

    const result = await translateAction('deposit 50 into scallop', {
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'placeholder-blob',
      client: {} as Anthropic,
      suiClient: {} as SuiClient,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action.amount).toBe(50)
      expect(typeof result.ptbBytes).toBe('string')
      expect(result.ptbBytes.length).toBeGreaterThan(0)
    }
  })

  it('returns validation errors without building a PTB when budget is exceeded', async () => {
    vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 450 })
    vi.mocked(fetchPolicyState).mockResolvedValue(validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 500 }))

    const result = await translateAction('deposit 450 into scallop', {
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'placeholder-blob',
      client: {} as Anthropic,
      suiClient: {} as SuiClient,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'amount',
        reason: 'spentTotal (100) + amount (450) exceeds maxTotalBudget (500)',
      })
    }
  })

  it('propagates a state-fetch failure as a thrown error', async () => {
    vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 50 })
    vi.mocked(fetchPolicyState).mockRejectedValue(new Error('object not found'))

    await expect(
      translateAction('deposit 50 into scallop', {
        policyId: POLICY_ID,
        packageId: PACKAGE_ID,
        walrusBlobId: 'placeholder-blob',
        client: {} as Anthropic,
        suiClient: {} as SuiClient,
      }),
    ).rejects.toThrow('object not found')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd actionflow && npx vitest run src/index.test.ts`
Expected: FAIL — `index.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `actionflow/src/index.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { SuiClient, getFullnodeUrl } from '@mysten/sui/client'
import { extractActionGoal, ExtractionRefusedError } from './extractor.js'
import type { RawActionGoal } from './extractor.js'
import { fetchPolicyState } from './policyState.js'
import { validateAction } from './validator.js'
import { buildRecordActionPtb } from './ptbBuilder.js'
import type { TranslateActionResult } from './types.js'

export interface TranslateActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  client?: Anthropic
  suiClient?: SuiClient
}

export async function translateAction(
  goal: string,
  opts: TranslateActionOptions,
): Promise<TranslateActionResult> {
  const client = opts.client ?? new Anthropic()
  const suiClient = opts.suiClient ?? new SuiClient({ url: getFullnodeUrl('testnet') })

  let raw: RawActionGoal
  try {
    raw = await extractActionGoal(goal, client)
  } catch (error) {
    if (error instanceof ExtractionRefusedError) {
      return { ok: false, errors: [{ field: '_root', reason: 'could not parse goal' }] }
    }
    throw error
  }

  const state = await fetchPolicyState(opts.policyId, suiClient)

  const validated = validateAction(raw, state, Date.now(), opts.policyId)
  if (!validated.ok) {
    return validated
  }

  const tx = buildRecordActionPtb(validated.action, opts.walrusBlobId, opts.packageId)
  const bytes = await tx.build({ onlyTransactionKind: true })
  const ptbBytes = Buffer.from(bytes).toString('base64')

  return { ok: true, action: validated.action, ptbBytes }
}

export { extractActionGoal, ExtractionRefusedError } from './extractor.js'
export { fetchPolicyState, PolicyFetchError } from './policyState.js'
export { validateAction } from './validator.js'
export { buildRecordActionPtb } from './ptbBuilder.js'
export type { RawActionGoal } from './extractor.js'
export type { PolicyState, PolicyAction, FieldError, ValidationResult, TranslateActionResult } from './types.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd actionflow && npx vitest run src/index.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Run the full test suite**

Run: `cd actionflow && npm test`
Expected: all test files pass (extractor, policyState, validator, ptbBuilder, index — 24 tests total).

- [ ] **Step 6: Commit**

```bash
git add actionflow/src/index.ts actionflow/src/index.test.ts
git commit -m "actionflow: compose extractor, state fetcher, validator, and PTB builder into translateAction"
```

---

### Task 7: CLI entry point and README

**Files:**
- Create: `actionflow/bin/actionflow.ts`
- Create: `actionflow/README.md`

**Interfaces:**
- Consumes: `translateAction` (Task 6).
- Produces: nothing consumed by other tasks (terminal task).

- [ ] **Step 1: Create `actionflow/bin/actionflow.ts`**

```typescript
#!/usr/bin/env node
import { translateAction } from '../src/index.js'

async function main() {
  const goal = process.argv.slice(2).join(' ')
  if (!goal) {
    console.error('Usage: actionflow "<goal text>"')
    process.exit(1)
  }

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

  const result = await translateAction(goal, { policyId, packageId, walrusBlobId })

  if (!result.ok) {
    console.error('Could not build an action from this goal:')
    for (const error of result.errors) {
      console.error(`  - ${error.field}: ${error.reason}`)
    }
    process.exit(1)
  }

  console.log('Action:')
  console.log(JSON.stringify(result.action, null, 2))
  console.log('\nPTB (base64):')
  console.log(result.ptbBytes)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
```

- [ ] **Step 2: Manually verify the no-args case**

Run: `cd actionflow && npm run cli --`
Expected: prints `Usage: actionflow "<goal text>"` to stderr and exits 1.

- [ ] **Step 3: Manually verify the missing-env-var case**

Run: `cd actionflow && npm run cli -- "deposit 100 into scallop"`
Expected: prints `Missing ACTIONFLOW_POLICY_ID environment variable` to stderr and exits 1 (no real Claude/Sui calls made, since the env check happens before any API call).

- [ ] **Step 4: Create `actionflow/README.md`**

```markdown
# ActionFlow

Translates a plain-English DeFi action goal into a validated action and an
unsigned Sui PTB calling `nexus_agent_wallet::policy::record_action`.

v1 scope: parses the action via Claude, fetches the live `PolicyObject`
from chain, validates the action against that live state (replicating
`record_action`'s on-chain checks), and builds the PTB. Construct-only —
no signing, no submission, no real protocol calls. See
`docs/superpowers/specs/2026-06-18-actionflow-design.md` for the full design.

**Note:** validation cannot check that the eventual transaction sender is
the policy's approved `agent` — there is no signer in this library. That
check still happens on-chain (`ENotAgent`) when the PTB is later submitted.

## Setup

```bash
cd actionflow
npm install
```

Requires `ANTHROPIC_API_KEY` in the environment (read automatically by the
Anthropic SDK).

## Usage

```bash
export ACTIONFLOW_POLICY_ID=0x...        # the on-chain PolicyObject's ID
export ACTIONFLOW_PACKAGE_ID=0x...       # nexus_agent_wallet package address
export ACTIONFLOW_WALRUS_BLOB_ID=placeholder-blob-id   # opaque placeholder, no real Walrus integration yet
npm run cli -- "deposit 100 into scallop, yield looks better there"
```

Prints the extracted action as JSON and the built PTB as base64 on
success, or a list of field-level errors (exit code 1) if the goal is
missing required information or violates a policy rule.

## Tests

```bash
npm test
```
```

- [ ] **Step 5: Commit**

```bash
git add actionflow/bin/actionflow.ts actionflow/README.md
git commit -m "actionflow: add CLI entry point and usage docs"
```

---

## Self-Review Notes

- **Spec coverage:** Purpose/Scope → Task 1 (package) + overall plan scope; Architecture's 4 stages → Tasks 2-5; the agent-identity caveat → documented in Task 4's validator and Task 7's README; `index.ts` composition → Task 6; CLI → Task 7. All Data Flow/Error Handling rows have a corresponding test (refusal in Task 2, all-null fallthrough in Task 2/6, `PolicyFetchError` in Task 3/6, field errors and business-rule violations in Task 4/6). All Testing section bullets from the spec map 1:1 to Tasks 2-6's test files.
- **Type consistency fix:** the spec's Component section for `validator.ts` didn't show `policyId` as a `validateAction` parameter, even though `PolicyAction` (produced by the validator) requires a `policyId` field. This plan adds `policyId: string` as `validateAction`'s fourth parameter (Task 4) and threads it through from `index.ts` (Task 6) — the only deviation from the spec's literal signatures, needed for internal consistency.
- **No placeholders:** every step above contains complete, runnable code; no "TBD"/"similar to Task N" shortcuts.
