# IntentFlow v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build IntentFlow v1 — a TypeScript library + CLI that translates a plain-English policy-setup goal into a validated strategy and an unsigned, locally-built Sui PTB calling `nexus_agent_wallet::policy::create_policy`.

**Architecture:** Three pure-ish layers (`extractor.ts` → `validator.ts` → `ptbBuilder.ts`) composed by `index.ts`'s `translateGoal()`, wrapped by a thin CLI. No network calls beyond the one Claude API request; no signing or submission.

**Tech Stack:** TypeScript (Node, ESM), `@anthropic-ai/sdk` (structured outputs via `client.messages.parse` + `zodOutputFormat`), `@mysten/sui` (`Transaction`, offline build via `onlyTransactionKind`), `zod`, `vitest`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-17-intentflow-design.md` — binding for every task below.
- v1 handles **policy-setup goals only** (budget, max single tx, allowed protocols, expiry). No action/execution goals, no real protocol integrations.
- **Construct-only**: build and return the unsigned PTB; never sign or submit to any network.
- **Single-pass extraction, no auto-repair, no clarification loop.** A field the goal doesn't state is a validation error, never a guess or a follow-up question.
- The LLM extracts `expiresInDays` (a relative duration), never an absolute timestamp — the absolute `expiresAtMs` is computed deterministically by `validateStrategy` from a `nowMs` passed in by the caller.
- `agentAddress` must appear explicitly in the goal text; IntentFlow never invents or looks up an address.
- Interface is a library + CLI only — no HTTP server in v1.
- Model: `claude-opus-4-8` (Claude API default per project convention).
- Test runner: `vitest`. Package manager: `npm`.
- Module system: ESM (`"type": "module"` in `package.json`), `NodeNext` module resolution in `tsconfig.json`.

---

## File Structure

```
intentflow/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  README.md
  src/
    types.ts          # PolicyStrategy, FieldError, ValidationResult, TranslateGoalResult
    extractor.ts       # RawStrategySchema/RawStrategy, ExtractionRefusedError, extractStrategy()
    extractor.test.ts
    validator.ts       # validateStrategy()
    validator.test.ts
    ptbBuilder.ts       # buildCreatePolicyPtb()
    ptbBuilder.test.ts
    index.ts           # translateGoal(), re-exports
    index.test.ts
  bin/
    intentflow.ts      # CLI entry point
```

---

### Task 1: Project scaffolding and shared types

**Files:**
- Create: `intentflow/package.json`
- Create: `intentflow/tsconfig.json`
- Create: `intentflow/vitest.config.ts`
- Create: `intentflow/.gitignore`
- Create: `intentflow/src/types.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `PolicyStrategy`, `FieldError`, `ValidationResult`, `TranslateGoalResult` (exported from `intentflow/src/types.ts`), plus the npm/TS/test scaffolding every later task runs against.

- [ ] **Step 1: Create the package manifest**

Create `intentflow/package.json`:

```json
{
  "name": "intentflow",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "cli": "tsx bin/intentflow.ts"
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

- [ ] **Step 2: Create the TypeScript config**

Create `intentflow/tsconfig.json`:

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

- [ ] **Step 3: Create the vitest config**

Create `intentflow/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 4: Create the gitignore**

Create `intentflow/.gitignore`:

```
node_modules
dist
```

- [ ] **Step 5: Install dependencies**

Run (from `intentflow/`): `npm install`
Expected: completes with no errors, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 6: Create the shared types module**

Create `intentflow/src/types.ts`:

```typescript
export interface PolicyStrategy {
  agentAddress: string
  maxTotalBudget: number
  maxSingleTx: number
  allowedProtocols: string[]
  expiresInDays: number
  expiresAtMs: number
}

export interface FieldError {
  field: string
  reason: string
}

export type ValidationResult =
  | { ok: true; strategy: PolicyStrategy }
  | { ok: false; errors: FieldError[] }

export type TranslateGoalResult =
  | { ok: true; strategy: PolicyStrategy; ptbBytes: string }
  | { ok: false; errors: FieldError[] }
```

- [ ] **Step 7: Verify the project compiles and the test harness runs**

Run (from `intentflow/`): `npx tsc --noEmit`
Expected: no output, exit code 0.

Run: `npx vitest run --passWithNoTests`
Expected: reports "No test files found, exiting with code 0" (or similar) and exits 0.

- [ ] **Step 8: Commit**

```bash
git add intentflow/package.json intentflow/package-lock.json intentflow/tsconfig.json intentflow/vitest.config.ts intentflow/.gitignore intentflow/src/types.ts
git commit -m "intentflow: scaffold project and add shared types"
```

---

### Task 2: Extractor — Claude API structured extraction

**Files:**
- Create: `intentflow/src/extractor.ts`
- Test: `intentflow/src/extractor.test.ts`

**Interfaces:**
- Consumes: `@anthropic-ai/sdk` (`Anthropic` client type, injected by caller), `zod`.
- Produces (from `intentflow/src/extractor.ts`, used by Task 3 and Task 5):
  - `RawStrategySchema` (zod schema)
  - `RawStrategy` (type, `z.infer<typeof RawStrategySchema>` — shape: `{ agentAddress: string | null; maxTotalBudget: number | null; maxSingleTx: number | null; allowedProtocols: string[] | null; expiresInDays: number | null }`)
  - `ExtractionRefusedError` (class extends `Error`)
  - `extractStrategy(goal: string, client: Anthropic): Promise<RawStrategy>`

- [ ] **Step 1: Write the failing tests**

Create `intentflow/src/extractor.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/extractor.test.ts`
Expected: FAIL — `Cannot find module './extractor.js'` (or similar), since `extractor.ts` doesn't exist yet.

- [ ] **Step 3: Implement the extractor**

Create `intentflow/src/extractor.ts`:

```typescript
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/extractor.test.ts`
Expected: PASS, 4/4 tests.

- [ ] **Step 5: Commit**

```bash
git add intentflow/src/extractor.ts intentflow/src/extractor.test.ts
git commit -m "intentflow: add Claude API extractor with structured outputs"
```

---

### Task 3: Validator — business rules and expiry derivation

**Files:**
- Create: `intentflow/src/validator.ts`
- Test: `intentflow/src/validator.test.ts`

**Interfaces:**
- Consumes: `RawStrategy` from `intentflow/src/extractor.ts` (Task 2); `PolicyStrategy`, `FieldError`, `ValidationResult` from `intentflow/src/types.ts` (Task 1).
- Produces: `validateStrategy(raw: RawStrategy, nowMs: number): ValidationResult` from `intentflow/src/validator.ts`, used by Task 5.

- [ ] **Step 1: Write the failing tests**

Create `intentflow/src/validator.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { validateStrategy } from './validator.js'
import type { RawStrategy } from './extractor.js'

const NOW = 1_700_000_000_000

function validRaw(overrides: Partial<RawStrategy> = {}): RawStrategy {
  return {
    agentAddress: '0xabc123',
    maxTotalBudget: 500,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresInDays: 30,
    ...overrides,
  }
}

describe('validateStrategy', () => {
  it('accepts a fully valid strategy and derives expiresAtMs', () => {
    const result = validateStrategy(validRaw(), NOW)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.strategy.expiresAtMs).toBe(NOW + 30 * 86_400_000)
      expect(result.strategy.agentAddress).toBe('0xabc123')
    }
  })

  it('accepts maxSingleTx equal to maxTotalBudget (boundary)', () => {
    const result = validateStrategy(validRaw({ maxTotalBudget: 100, maxSingleTx: 100 }), NOW)
    expect(result.ok).toBe(true)
  })

  it('rejects zero maxTotalBudget', () => {
    const result = validateStrategy(validRaw({ maxTotalBudget: 0 }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'maxTotalBudget',
        reason: 'must be greater than 0, got 0',
      })
    }
  })

  it('rejects maxSingleTx greater than maxTotalBudget', () => {
    const result = validateStrategy(validRaw({ maxTotalBudget: 100, maxSingleTx: 150 }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'maxSingleTx',
        reason: 'maxSingleTx (150) exceeds maxTotalBudget (100)',
      })
    }
  })

  it('rejects an empty allowedProtocols list', () => {
    const result = validateStrategy(validRaw({ allowedProtocols: [] }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'allowedProtocols',
        reason: 'must name at least one protocol',
      })
    }
  })

  it('rejects a non-positive expiresInDays', () => {
    const result = validateStrategy(validRaw({ expiresInDays: 0 }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'expiresInDays',
        reason: 'must be greater than 0, got 0',
      })
    }
  })

  it('rejects a malformed agent address', () => {
    const result = validateStrategy(validRaw({ agentAddress: 'not-an-address' }), NOW)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'agentAddress',
        reason: '"not-an-address" is not a valid Sui address',
      })
    }
  })

  it('reports every missing field when all are null', () => {
    const result = validateStrategy(
      {
        agentAddress: null,
        maxTotalBudget: null,
        maxSingleTx: null,
        allowedProtocols: null,
        expiresInDays: null,
      },
      NOW,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(5)
      expect(result.errors.map((e) => e.field).sort()).toEqual(
        ['agentAddress', 'allowedProtocols', 'expiresInDays', 'maxSingleTx', 'maxTotalBudget'].sort(),
      )
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/validator.test.ts`
Expected: FAIL — `Cannot find module './validator.js'`.

- [ ] **Step 3: Implement the validator**

Create `intentflow/src/validator.ts`:

```typescript
import type { RawStrategy } from './extractor.js'
import type { FieldError, PolicyStrategy, ValidationResult } from './types.js'

const MS_PER_DAY = 86_400_000
const SUI_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/

export function validateStrategy(raw: RawStrategy, nowMs: number): ValidationResult {
  const errors: FieldError[] = []

  if (raw.agentAddress === null) {
    errors.push({ field: 'agentAddress', reason: 'not specified in goal' })
  }
  if (raw.maxTotalBudget === null) {
    errors.push({ field: 'maxTotalBudget', reason: 'not specified in goal' })
  }
  if (raw.maxSingleTx === null) {
    errors.push({ field: 'maxSingleTx', reason: 'not specified in goal' })
  }
  if (raw.allowedProtocols === null) {
    errors.push({ field: 'allowedProtocols', reason: 'not specified in goal' })
  }
  if (raw.expiresInDays === null) {
    errors.push({ field: 'expiresInDays', reason: 'not specified in goal' })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const agentAddress = raw.agentAddress as string
  const maxTotalBudget = raw.maxTotalBudget as number
  const maxSingleTx = raw.maxSingleTx as number
  const allowedProtocols = raw.allowedProtocols as string[]
  const expiresInDays = raw.expiresInDays as number

  if (!SUI_ADDRESS_PATTERN.test(agentAddress)) {
    errors.push({ field: 'agentAddress', reason: `"${agentAddress}" is not a valid Sui address` })
  }
  if (maxTotalBudget <= 0) {
    errors.push({ field: 'maxTotalBudget', reason: `must be greater than 0, got ${maxTotalBudget}` })
  }
  if (maxSingleTx <= 0) {
    errors.push({ field: 'maxSingleTx', reason: `must be greater than 0, got ${maxSingleTx}` })
  } else if (maxSingleTx > maxTotalBudget) {
    errors.push({
      field: 'maxSingleTx',
      reason: `maxSingleTx (${maxSingleTx}) exceeds maxTotalBudget (${maxTotalBudget})`,
    })
  }
  if (allowedProtocols.length === 0) {
    errors.push({ field: 'allowedProtocols', reason: 'must name at least one protocol' })
  }
  if (expiresInDays <= 0) {
    errors.push({ field: 'expiresInDays', reason: `must be greater than 0, got ${expiresInDays}` })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const strategy: PolicyStrategy = {
    agentAddress,
    maxTotalBudget,
    maxSingleTx,
    allowedProtocols,
    expiresInDays,
    expiresAtMs: nowMs + expiresInDays * MS_PER_DAY,
  }

  return { ok: true, strategy }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/validator.test.ts`
Expected: PASS, 8/8 tests.

- [ ] **Step 5: Commit**

```bash
git add intentflow/src/validator.ts intentflow/src/validator.test.ts
git commit -m "intentflow: add strategy validator with policy.move business rules"
```

---

### Task 4: PTB builder — offline Sui transaction construction

**Files:**
- Create: `intentflow/src/ptbBuilder.ts`
- Test: `intentflow/src/ptbBuilder.test.ts`

**Interfaces:**
- Consumes: `PolicyStrategy` from `intentflow/src/types.ts` (Task 1); `Transaction` from `@mysten/sui/transactions`.
- Produces: `buildCreatePolicyPtb(strategy: PolicyStrategy, packageId: string): Transaction` from `intentflow/src/ptbBuilder.ts`, used by Task 5.

**Background (verified against installed `@mysten/sui@2.18.0`):**
- `create_policy`'s on-chain signature is `(agent: address, max_total_budget: u64, max_single_tx: u64, allowed_protocols: vector<vector<u8>>, expires_at_ms: u64, clock: &Clock, ctx: &mut TxContext)` (`nexus_agent_wallet/sources/policy.move:76-84`). `ctx` is supplied automatically by the runtime and is never part of the `moveCall` arguments array.
- The Sui `Clock` shared object lives at `0x6` with a stable `initialSharedVersion` of `1` on every network since genesis — passing it via `tx.sharedObjectRef({ objectId, initialSharedVersion, mutable })` lets the PTB be built with no network/client lookup.
- `tx.build({ onlyTransactionKind: true })` builds to bytes without a client when every input (pure values + the manually-specified shared object ref) is already fully resolved, which is the case here.

- [ ] **Step 1: Write the failing tests**

Create `intentflow/src/ptbBuilder.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { buildCreatePolicyPtb } from './ptbBuilder.js'
import type { PolicyStrategy } from './types.js'

const STRATEGY: PolicyStrategy = {
  agentAddress: '0x' + 'ab'.repeat(32),
  maxTotalBudget: 500,
  maxSingleTx: 100,
  allowedProtocols: ['scallop', 'deepbook'],
  expiresInDays: 30,
  expiresAtMs: 1_702_592_000_000,
}

const PACKAGE_ID = '0x' + '11'.repeat(32)

describe('buildCreatePolicyPtb', () => {
  it('adds exactly one moveCall targeting policy::create_policy', () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const data = tx.getData()
    const moveCalls = data.commands.filter(
      (c): c is { $kind: 'MoveCall'; MoveCall: { package: string; module: string; function: string; arguments: unknown[] } } =>
        c.$kind === 'MoveCall',
    )

    expect(moveCalls).toHaveLength(1)
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('create_policy')
    expect(call.arguments).toHaveLength(6)
  })

  it('builds to bytes without requiring a network client', async () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/ptbBuilder.test.ts`
Expected: FAIL — `Cannot find module './ptbBuilder.js'`.

- [ ] **Step 3: Implement the PTB builder**

Create `intentflow/src/ptbBuilder.ts`:

```typescript
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyStrategy } from './types.js'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SUI_CLOCK_INITIAL_SHARED_VERSION = 1

export function buildCreatePolicyPtb(strategy: PolicyStrategy, packageId: string): Transaction {
  const tx = new Transaction()

  const allowedProtocolsBytes = strategy.allowedProtocols.map((protocol) =>
    Array.from(new TextEncoder().encode(protocol)),
  )

  tx.moveCall({
    target: `${packageId}::policy::create_policy`,
    arguments: [
      tx.pure.address(strategy.agentAddress),
      tx.pure.u64(strategy.maxTotalBudget),
      tx.pure.u64(strategy.maxSingleTx),
      tx.pure.vector('vector<u8>', allowedProtocolsBytes),
      tx.pure.u64(strategy.expiresAtMs),
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

Run: `npx vitest run src/ptbBuilder.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Commit**

```bash
git add intentflow/src/ptbBuilder.ts intentflow/src/ptbBuilder.test.ts
git commit -m "intentflow: add offline PTB builder for create_policy"
```

---

### Task 5: Compose — `translateGoal`

**Files:**
- Create: `intentflow/src/index.ts`
- Test: `intentflow/src/index.test.ts`

**Interfaces:**
- Consumes: `extractStrategy`, `ExtractionRefusedError` from `intentflow/src/extractor.ts` (Task 2); `validateStrategy` from `intentflow/src/validator.ts` (Task 3); `buildCreatePolicyPtb` from `intentflow/src/ptbBuilder.ts` (Task 4); `TranslateGoalResult` from `intentflow/src/types.ts` (Task 1).
- Produces: `translateGoal(goal: string, opts: TranslateGoalOptions): Promise<TranslateGoalResult>` and re-exports of every public symbol from `intentflow/src/index.ts`, used by Task 6 (CLI).

- [ ] **Step 1: Write the failing tests**

Create `intentflow/src/index.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('./extractor.js', () => ({
  extractStrategy: vi.fn(),
  ExtractionRefusedError: class ExtractionRefusedError extends Error {},
}))

import { extractStrategy } from './extractor.js'
import { translateGoal } from './index.js'

describe('translateGoal', () => {
  it('returns strategy and ptbBytes on a full happy path', async () => {
    vi.mocked(extractStrategy).mockResolvedValue({
      agentAddress: '0x' + 'ab'.repeat(32),
      maxTotalBudget: 500,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresInDays: 30,
    })

    const result = await translateGoal('Let my agent trade with a $500 budget', {
      packageId: '0x' + '11'.repeat(32),
      client: {} as Anthropic,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.strategy.maxTotalBudget).toBe(500)
      expect(typeof result.ptbBytes).toBe('string')
      expect(result.ptbBytes.length).toBeGreaterThan(0)
    }
  })

  it('returns validation errors without building a PTB', async () => {
    vi.mocked(extractStrategy).mockResolvedValue({
      agentAddress: null,
      maxTotalBudget: 500,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresInDays: 30,
    })

    const result = await translateGoal('goal missing an address', {
      packageId: '0x' + '11'.repeat(32),
      client: {} as Anthropic,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({ field: 'agentAddress', reason: 'not specified in goal' })
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/index.test.ts`
Expected: FAIL — `Cannot find module './index.js'`.

- [ ] **Step 3: Implement the composition**

Create `intentflow/src/index.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { extractStrategy, ExtractionRefusedError } from './extractor.js'
import type { RawStrategy } from './extractor.js'
import { validateStrategy } from './validator.js'
import { buildCreatePolicyPtb } from './ptbBuilder.js'
import type { TranslateGoalResult } from './types.js'

export interface TranslateGoalOptions {
  packageId: string
  client?: Anthropic
}

export async function translateGoal(
  goal: string,
  opts: TranslateGoalOptions,
): Promise<TranslateGoalResult> {
  const client = opts.client ?? new Anthropic()

  let raw: RawStrategy
  try {
    raw = await extractStrategy(goal, client)
  } catch (error) {
    if (error instanceof ExtractionRefusedError) {
      return { ok: false, errors: [{ field: '_root', reason: 'could not parse goal' }] }
    }
    throw error
  }

  const validated = validateStrategy(raw, Date.now())
  if (!validated.ok) {
    return validated
  }

  const tx = buildCreatePolicyPtb(validated.strategy, opts.packageId)
  const bytes = await tx.build({ onlyTransactionKind: true })
  const ptbBytes = Buffer.from(bytes).toString('base64')

  return { ok: true, strategy: validated.strategy, ptbBytes }
}

export { extractStrategy, ExtractionRefusedError } from './extractor.js'
export { validateStrategy } from './validator.js'
export { buildCreatePolicyPtb } from './ptbBuilder.js'
export type { RawStrategy } from './extractor.js'
export type { PolicyStrategy, FieldError, ValidationResult, TranslateGoalResult } from './types.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/index.test.ts`
Expected: PASS, 2/2 tests.

- [ ] **Step 5: Run the full test suite**

Run (from `intentflow/`): `npm test`
Expected: PASS, all tests across all files (16 tests: 4 extractor + 8 validator + 2 ptbBuilder + 2 index).

- [ ] **Step 6: Commit**

```bash
git add intentflow/src/index.ts intentflow/src/index.test.ts
git commit -m "intentflow: compose extractor, validator, and PTB builder into translateGoal"
```

---

### Task 6: CLI entry point and usage docs

**Files:**
- Create: `intentflow/bin/intentflow.ts`
- Create: `intentflow/README.md`

**Interfaces:**
- Consumes: `translateGoal` from `intentflow/src/index.ts` (Task 5).
- Produces: a runnable CLI (`npm run cli -- "<goal>"`). Final deliverable of this plan.

- [ ] **Step 1: Implement the CLI**

Create `intentflow/bin/intentflow.ts`:

```typescript
#!/usr/bin/env node
import { translateGoal } from '../src/index.js'

async function main() {
  const goal = process.argv.slice(2).join(' ')
  if (!goal) {
    console.error('Usage: intentflow "<goal text>"')
    process.exit(1)
  }

  const packageId = process.env.INTENTFLOW_PACKAGE_ID
  if (!packageId) {
    console.error('Missing INTENTFLOW_PACKAGE_ID environment variable')
    process.exit(1)
  }

  const result = await translateGoal(goal, { packageId })

  if (!result.ok) {
    console.error('Could not build a policy from this goal:')
    for (const error of result.errors) {
      console.error(`  - ${error.field}: ${error.reason}`)
    }
    process.exit(1)
  }

  console.log('Strategy:')
  console.log(JSON.stringify(result.strategy, null, 2))
  console.log('\nPTB (base64):')
  console.log(result.ptbBytes)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
```

- [ ] **Step 2: Verify the CLI fails cleanly with no arguments**

Run (from `intentflow/`): `npx tsx bin/intentflow.ts`
Expected: prints `Usage: intentflow "<goal text>"` to stderr, exits 1.

- [ ] **Step 3: Verify the CLI fails cleanly with no package ID configured**

Run: `npx tsx bin/intentflow.ts "Let my agent trade on Scallop with a $500 budget"`
Expected (with `INTENTFLOW_PACKAGE_ID` unset): prints `Missing INTENTFLOW_PACKAGE_ID environment variable` to stderr, exits 1.

- [ ] **Step 4: Write the README**

Create `intentflow/README.md`:

```markdown
# IntentFlow

Translates a plain-English policy-setup goal into a validated strategy and
an unsigned Sui PTB calling `nexus_agent_wallet::policy::create_policy`.

v1 scope: policy-setup goals only (budget, max single tx, allowed
protocols, expiry). Construct-only — no signing, no submission. See
`docs/superpowers/specs/2026-06-17-intentflow-design.md` for the full design.

## Setup

```bash
cd intentflow
npm install
```

Requires `ANTHROPIC_API_KEY` in the environment (read automatically by the
Anthropic SDK).

## Usage

```bash
export INTENTFLOW_PACKAGE_ID=0x...   # nexus_agent_wallet package address
npm run cli -- "Let agent 0xabc...123 trade on Scallop and DeepBook with a \$500 budget, max \$100 per trade, expiring in 30 days"
```

Prints the extracted strategy as JSON and the built PTB as base64 on
success, or a list of field-level errors (exit code 1) if the goal is
missing required information or violates a policy rule.

## Tests

```bash
npm test
```
```

- [ ] **Step 5: Manual smoke test (optional, requires a real `ANTHROPIC_API_KEY`)**

Run:

```bash
export ANTHROPIC_API_KEY=<your key>
export INTENTFLOW_PACKAGE_ID=0x1111111111111111111111111111111111111111111111111111111111111111
npm run cli -- "Let agent 0xabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabcabca trade on Scallop and DeepBook with a 500 budget, max 100 per trade, expiring in 30 days"
```

Expected: prints a `Strategy:` JSON block with `maxTotalBudget: 500`, `maxSingleTx: 100`, `allowedProtocols: ["scallop", "deepbook"]`, a derived `expiresAtMs` roughly 30 days out, and a non-empty base64 `PTB` block.

- [ ] **Step 6: Commit**

```bash
git add intentflow/bin/intentflow.ts intentflow/README.md
git commit -m "intentflow: add CLI entry point and usage docs"
```

---

## Plan Self-Review Notes

- **Spec coverage:** every component in the design spec (extractor, validator, PTB builder, `translateGoal`, CLI) maps to a task; every error-handling row in the spec's table is covered by a test (refusal → Task 2, missing/null field and business-rule violations → Task 3, infra error propagation → Task 5's `try`/re-throw).
- **Type consistency:** `RawStrategy` (Task 2) is consumed identically by Task 3 and Task 5; `PolicyStrategy` (Task 1) is consumed identically by Task 3's output, Task 4's input, and Task 5's `TranslateGoalResult`. Field names (`agentAddress`, `maxTotalBudget`, `maxSingleTx`, `allowedProtocols`, `expiresInDays`, `expiresAtMs`) are identical across every task.
- **One spec gap closed during planning:** the design spec didn't specify how the Move contract's `vector<vector<u8>>` protocol list or the `&Clock` argument get built without a live network. Resolved by verifying the installed `@mysten/sui@2.18.0` API directly (`tx.pure.vector('vector<u8>', ...)`, `tx.sharedObjectRef(...)` with the Clock's well-known `initialSharedVersion: 1`, and `tx.build({ onlyTransactionKind: true })` requiring no client when all inputs are already resolved) — documented in Task 4's Background section.
- **One additional validation rule added beyond the spec's literal text:** `agentAddress` format checking (`SUI_ADDRESS_PATTERN`) in Task 3, since the spec already commits to "no auto-repair" and a malformed address from the LLM would otherwise surface as a confusing low-level SDK exception in Task 4 instead of a clear field error.
