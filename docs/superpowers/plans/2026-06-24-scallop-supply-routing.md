# Scallop Supply Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire ActionFlow, AgentRunner, and PolicyLoop so a Scallop-supply decision or goal calls the real `scallop_adapter::supply_sui` Move entry point instead of the bookkeeping-only `policy::record_action`, per `docs/superpowers/specs/2026-06-24-scallop-supply-routing-design.md`.

**Architecture:** Add an explicit `action: 'supply' | 'withdraw'` direction alongside `protocol`/`amount` everywhere a `PolicyAction` flows. A single routing function, `buildActionPtb`, decides per-action whether to call the new Scallop PTB builder or fall back to the existing `record_action` builder; `translateAction` and `runPolicyCycle` both call it instead of `buildRecordActionPtb` directly. `submitTransaction` is extended to recognize either resulting on-chain event.

**Tech Stack:** TypeScript, Vitest, `@mysten/sui` Transaction/PTB builder, Zod (extractor schema).

## Global Constraints

- Scallop config (`versionObjectId`, `marketObjectId`) is supplied by the caller; never hardcode mainnet object IDs in source.
- `action` is only enforced for `protocol === 'scallop'`; other protocols accept either direction value and keep using `record_action`.
- No new test infra — use the existing Vitest setup and mocking patterns already present in each package's `*.test.ts`.
- `npm test` in this repo's packages runs `vitest run`, which transpiles but does **not** type-check; only `npm run build` (`tsc`) catches type errors. Every task that introduces a new required field must avoid breaking `npm test` immediately, and Task 10 verifies full type-checking across all three packages at the end.

---

### Task 1: Add `action` direction to ActionFlow's extracted/validated shapes

**Files:**
- Modify: `actionflow/src/extractor.ts`
- Modify: `actionflow/src/types.ts`
- Test: `actionflow/src/extractor.test.ts`

**Interfaces:**
- Produces: `RawActionGoal.action: 'supply' | 'withdraw' | null`, `PolicyAction.action: 'supply' | 'withdraw'`

- [ ] **Step 1: Update the extractor schema and system prompt**

In `actionflow/src/extractor.ts`, replace the schema and prompt:

```ts
export const RawActionGoalSchema = z.object({
  protocol: z.string().nullable(),
  amount: z.number().nullable(),
  action: z.enum(['supply', 'withdraw']).nullable(),
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
- action: "supply" if the user wants to deposit, add, or supply funds into the protocol; "withdraw" if the user wants to withdraw, redeem, or pull funds out. ONLY if the user's intent is clearly one of these two.

If the user did not state a field, return null for it. Do not guess, default, or infer values that are not present in the text.`
```

Leave `extractActionGoal` itself unchanged — it already returns `message.parsed_output` verbatim, so the new field flows through automatically.

- [ ] **Step 2: Add `action` to `PolicyAction`**

In `actionflow/src/types.ts`, update:

```ts
export interface PolicyAction {
  policyId: string
  protocol: string
  amount: number
  action: 'supply' | 'withdraw'
}
```

- [ ] **Step 3: Update and extend the extractor tests**

In `actionflow/src/extractor.test.ts`, replace the first test and add a null-action case:

```ts
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
```

- [ ] **Step 4: Run the extractor tests**

Run from `actionflow`:

```powershell
npm test -- extractor.test.ts
```

Expected: 5 passed, 0 failed.

- [ ] **Step 5: Commit**

```powershell
git add actionflow/src/extractor.ts actionflow/src/types.ts actionflow/src/extractor.test.ts
git commit -m "feat: extract a supply/withdraw action direction"
```

---

### Task 2: Enforce the direction rule in `validateAction`

**Files:**
- Modify: `actionflow/src/validator.ts`
- Test: `actionflow/src/validator.test.ts`

**Interfaces:**
- Consumes: `PolicyAction` (Task 1), `RawActionGoal.action` (Task 1)
- Produces: `validateAction` rejects `protocol === 'scallop' && action !== 'supply'` with `{ field: 'action', reason: 'scallop withdraw is not supported on-chain yet' }`

- [ ] **Step 1: Write the failing tests**

In `actionflow/src/validator.test.ts`, update `validRaw` to include `action`, update existing assertions on the returned `action` object, and add new direction-specific cases:

```ts
function validRaw(overrides: Partial<RawActionGoal> = {}): RawActionGoal {
  return {
    protocol: 'scallop',
    amount: 100,
    action: 'supply',
    ...overrides,
  }
}
```

```ts
it('accepts a fully valid action', () => {
  const result = validateAction(validRaw(), validState(), NOW, POLICY_ID)
  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.action).toEqual({ policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' })
  }
})
```

```ts
it('rejects a null action', () => {
  const result = validateAction(validRaw({ action: null }), validState(), NOW, POLICY_ID)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.errors).toContainEqual({ field: 'action', reason: 'not specified in goal' })
  }
})

it('rejects a scallop withdraw as not yet supported on-chain', () => {
  const result = validateAction(validRaw({ action: 'withdraw' }), validState(), NOW, POLICY_ID)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.errors).toContainEqual({
      field: 'action',
      reason: 'scallop withdraw is not supported on-chain yet',
    })
  }
})

it('accepts a withdraw action for a non-scallop protocol', () => {
  const result = validateAction(
    validRaw({ protocol: 'deepbook', action: 'withdraw' }),
    validState({ allowedProtocols: ['deepbook'] }),
    NOW,
    POLICY_ID,
  )
  expect(result.ok).toBe(true)
})
```

Also update `'rejects a null protocol and null amount together'` to confirm `action` is unaffected:

```ts
it('rejects a null protocol and null amount together', () => {
  const result = validateAction(validRaw({ protocol: null, amount: null }), validState(), NOW, POLICY_ID)
  expect(result.ok).toBe(false)
  if (!result.ok) {
    expect(result.errors).toHaveLength(2)
    expect(result.errors.map((e) => e.field).sort()).toEqual(['amount', 'protocol'])
  }
})
```

- [ ] **Step 2: Run the validator tests and confirm the new ones fail**

Run from `actionflow`:

```powershell
npm test -- validator.test.ts
```

Expected: the two new tests (`rejects a null action`, `rejects a scallop withdraw...`) FAIL — `action` isn't read or validated yet, so a null action passes through and a withdraw is never rejected.

- [ ] **Step 3: Implement the validation rule**

In `actionflow/src/validator.ts`:

```ts
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
  if (raw.action === null) {
    errors.push({ field: 'action', reason: 'not specified in goal' })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const protocol = raw.protocol as string
  const amount = raw.amount as number
  const action = raw.action as 'supply' | 'withdraw'

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
  if (protocol === 'scallop' && action !== 'supply') {
    errors.push({ field: 'action', reason: `scallop ${action} is not supported on-chain yet` })
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

  const validatedAction: PolicyAction = { policyId, protocol, amount, action }
  return { ok: true, action: validatedAction }
}
```

- [ ] **Step 4: Run the validator tests and confirm all pass**

```powershell
npm test -- validator.test.ts
```

Expected: all tests passed, 0 failed.

- [ ] **Step 5: Run the full actionflow suite**

```powershell
npm test
```

Expected: all test files pass (extractor/validator updated; other files not yet touched still reference the old `PolicyAction`/`RawActionGoal` shape in ways that transpile fine under Vitest's no-typecheck transform).

- [ ] **Step 6: Commit**

```powershell
git add actionflow/src/validator.ts actionflow/src/validator.test.ts
git commit -m "feat: reject unsupported Scallop withdraw direction"
```

---

### Task 3: Add the Scallop PTB builder and routing function

**Files:**
- Modify: `actionflow/src/types.ts`
- Modify: `actionflow/src/ptbBuilder.ts`
- Test: `actionflow/src/ptbBuilder.test.ts`

**Interfaces:**
- Consumes: `PolicyAction` (Task 1)
- Produces: `ScallopConfig`, `buildScallopSupplySuiPtb(action, walrusBlobId, packageId, scallop, policyInitialSharedVersion?): Transaction`, `BuildActionPtbResult`, `buildActionPtb(action, walrusBlobId, packageId, scallop, policyInitialSharedVersion?): BuildActionPtbResult`

- [ ] **Step 1: Add `ScallopConfig` to types.ts**

In `actionflow/src/types.ts`, add:

```ts
export interface ScallopConfig {
  versionObjectId: string
  marketObjectId: string
  versionInitialSharedVersion?: string | number
  marketInitialSharedVersion?: string | number
}
```

- [ ] **Step 2: Write the failing PTB builder tests**

In `actionflow/src/ptbBuilder.test.ts`, update the existing `ACTION` literal and add new describe blocks:

```ts
import { describe, expect, it } from 'vitest'
import { buildActionPtb, buildRecordActionPtb, buildScallopSupplySuiPtb } from './ptbBuilder.js'
import type { PolicyAction, ScallopConfig } from './types.js'

const ACTION: PolicyAction = {
  policyId: '0x' + 'aa'.repeat(32),
  protocol: 'scallop',
  amount: 100,
  action: 'supply',
}

const SCALLOP_CONFIG: ScallopConfig = {
  versionObjectId: '0x' + '22'.repeat(32),
  marketObjectId: '0x' + '33'.repeat(32),
  versionInitialSharedVersion: 1,
  marketInitialSharedVersion: 1,
}

const WALRUS_BLOB_ID = 'placeholder-blob-id'
const PACKAGE_ID = '0x' + '11'.repeat(32)

describe('buildRecordActionPtb', () => {
  it('adds exactly one moveCall targeting policy::record_action', () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
    const data = tx.getData()
    const moveCalls = data.commands.filter((c) => c.$kind === 'MoveCall')

    expect(moveCalls).toHaveLength(1)
    if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('record_action')
    expect(call.arguments).toHaveLength(5)
  })

  it('builds to bytes without requiring a network client when given the policy object version', async () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, 1)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('throws when building without a client and without the policy object version', async () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
    await expect(tx.build({ onlyTransactionKind: true })).rejects.toThrow(/sui client/i)
  })
})

describe('buildScallopSupplySuiPtb', () => {
  it('adds exactly one moveCall targeting scallop_adapter::supply_sui with six arguments', () => {
    const tx = buildScallopSupplySuiPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, SCALLOP_CONFIG, 1)
    const data = tx.getData()
    const moveCalls = data.commands.filter((c) => c.$kind === 'MoveCall')

    expect(moveCalls).toHaveLength(1)
    if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('scallop_adapter')
    expect(call.function).toBe('supply_sui')
    expect(call.arguments).toHaveLength(6)
  })

  it('builds to bytes without a network client when all object versions are given', async () => {
    const tx = buildScallopSupplySuiPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, SCALLOP_CONFIG, 1)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})

describe('buildActionPtb', () => {
  it('routes a scallop supply action to buildScallopSupplySuiPtb', () => {
    const result = buildActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, SCALLOP_CONFIG, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
      if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
      expect(moveCalls[0].MoveCall.function).toBe('supply_sui')
    }
  })

  it('returns config_missing when a scallop supply action has no scallop config', () => {
    const result = buildActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
    expect(result).toEqual({
      ok: false,
      status: 'config_missing',
      reason: 'scallop config required for scallop supply',
    })
  })

  it('routes a non-scallop protocol to buildRecordActionPtb even without scallop config', () => {
    const action: PolicyAction = { ...ACTION, protocol: 'deepbook' }
    const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
      if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
      expect(moveCalls[0].MoveCall.function).toBe('record_action')
    }
  })

  it('routes a scallop withdraw action to buildRecordActionPtb (the routing function only branches on supply; validateAction is what rejects withdraw earlier)', () => {
    const action: PolicyAction = { ...ACTION, action: 'withdraw' }
    const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
      if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
      expect(moveCalls[0].MoveCall.function).toBe('record_action')
    }
  })
})
```

- [ ] **Step 3: Run the PTB builder tests and confirm the new ones fail**

```powershell
npm test -- ptbBuilder.test.ts
```

Expected: FAIL — `buildScallopSupplySuiPtb` and `buildActionPtb` are not exported from `./ptbBuilder.js` yet.

- [ ] **Step 4: Implement `buildScallopSupplySuiPtb` and `buildActionPtb`**

Replace the contents of `actionflow/src/ptbBuilder.ts`:

```ts
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyAction, ScallopConfig } from './types.js'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SUI_CLOCK_INITIAL_SHARED_VERSION = 1

export function buildRecordActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  policyInitialSharedVersion?: string | number,
): Transaction {
  const tx = new Transaction()

  // PolicyObject is a shared object on-chain (transfer::share_object in policy.move).
  // Sui requires the object's current shared version to build a transaction offline
  // (without a client to resolve it) — same reason the Clock reference below needs one.
  const policyArg =
    policyInitialSharedVersion === undefined
      ? tx.object(action.policyId)
      : tx.sharedObjectRef({
          objectId: action.policyId,
          initialSharedVersion: policyInitialSharedVersion,
          mutable: true,
        })

  tx.moveCall({
    target: `${packageId}::policy::record_action`,
    arguments: [
      policyArg,
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

export function buildScallopSupplySuiPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig,
  policyInitialSharedVersion?: string | number,
): Transaction {
  const tx = new Transaction()

  const policyArg =
    policyInitialSharedVersion === undefined
      ? tx.object(action.policyId)
      : tx.sharedObjectRef({
          objectId: action.policyId,
          initialSharedVersion: policyInitialSharedVersion,
          mutable: true,
        })

  const versionArg =
    scallop.versionInitialSharedVersion === undefined
      ? tx.object(scallop.versionObjectId)
      : tx.sharedObjectRef({
          objectId: scallop.versionObjectId,
          initialSharedVersion: scallop.versionInitialSharedVersion,
          mutable: false,
        })

  const marketArg =
    scallop.marketInitialSharedVersion === undefined
      ? tx.object(scallop.marketObjectId)
      : tx.sharedObjectRef({
          objectId: scallop.marketObjectId,
          initialSharedVersion: scallop.marketInitialSharedVersion,
          mutable: true,
        })

  tx.moveCall({
    target: `${packageId}::scallop_adapter::supply_sui`,
    arguments: [
      policyArg,
      tx.pure.u64(action.amount),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(walrusBlobId))),
      versionArg,
      marketArg,
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}

export type BuildActionPtbResult =
  | { ok: true; tx: Transaction }
  | { ok: false; status: 'config_missing'; reason: string }

export function buildActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig | undefined,
  policyInitialSharedVersion?: string | number,
): BuildActionPtbResult {
  if (action.protocol === 'scallop' && action.action === 'supply') {
    if (!scallop) {
      return { ok: false, status: 'config_missing', reason: 'scallop config required for scallop supply' }
    }
    return {
      ok: true,
      tx: buildScallopSupplySuiPtb(action, walrusBlobId, packageId, scallop, policyInitialSharedVersion),
    }
  }
  return { ok: true, tx: buildRecordActionPtb(action, walrusBlobId, packageId, policyInitialSharedVersion) }
}
```

- [ ] **Step 5: Run the PTB builder tests and confirm all pass**

```powershell
npm test -- ptbBuilder.test.ts
```

Expected: all tests passed, 0 failed.

- [ ] **Step 6: Commit**

```powershell
git add actionflow/src/types.ts actionflow/src/ptbBuilder.ts actionflow/src/ptbBuilder.test.ts
git commit -m "feat: add Scallop supply PTB builder and action routing"
```

---

### Task 4: Wire `translateAction` to use `buildActionPtb` and export the new surface

**Files:**
- Modify: `actionflow/src/index.ts`
- Test: `actionflow/src/index.test.ts`

**Interfaces:**
- Consumes: `buildActionPtb`, `ScallopConfig` (Task 3)
- Produces: `TranslateActionOptions.scallop?: ScallopConfig`, `TranslateActionResult` gains `{ ok: false; status: 'config_missing'; reason: string }`

- [ ] **Step 1: Write the failing test**

In `actionflow/src/index.test.ts`, add a new test after the existing happy-path test (which itself needs its mocked `extractActionGoal`/`getMoveFunction` data updated — see Step 3):

```ts
it('returns config_missing when a scallop supply goal has no scallop config', async () => {
  vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 50, action: 'supply' })
  vi.mocked(fetchPolicyState).mockResolvedValue(validState())

  const result = await translateAction('deposit 50 into scallop', {
    policyId: POLICY_ID,
    packageId: PACKAGE_ID,
    walrusBlobId: 'placeholder-blob',
    client: {} as Anthropic,
    suiClient: {} as SuiJsonRpcClient,
  })

  expect(result).toEqual({
    ok: false,
    status: 'config_missing',
    reason: 'scallop config required for scallop supply',
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails**

```powershell
npm test -- index.test.ts
```

Expected: FAIL — `translateAction` still calls `buildRecordActionPtb` unconditionally and never returns a `config_missing` result.

- [ ] **Step 3: Update `translateAction`**

Replace `actionflow/src/index.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { extractActionGoal, ExtractionRefusedError } from './extractor.js'
import type { RawActionGoal } from './extractor.js'
import { fetchPolicyState } from './policyState.js'
import { validateAction } from './validator.js'
import { buildActionPtb } from './ptbBuilder.js'
import type { ScallopConfig, TranslateActionResult } from './types.js'

export interface TranslateActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  scallop?: ScallopConfig
  client?: Anthropic
  suiClient?: SuiJsonRpcClient
}

export async function translateAction(
  goal: string,
  opts: TranslateActionOptions,
): Promise<TranslateActionResult> {
  const client = opts.client ?? new Anthropic()
  const suiClient = opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

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

  const built = buildActionPtb(validated.action, opts.walrusBlobId, opts.packageId, opts.scallop)
  if (!built.ok) {
    return built
  }

  const bytes = await built.tx.build({ onlyTransactionKind: true, client: suiClient })
  const ptbBytes = Buffer.from(bytes).toString('base64')

  return { ok: true, action: validated.action, ptbBytes }
}

export { extractActionGoal, ExtractionRefusedError } from './extractor.js'
export { fetchPolicyState, PolicyFetchError } from './policyState.js'
export { validateAction } from './validator.js'
export { buildRecordActionPtb, buildScallopSupplySuiPtb, buildActionPtb } from './ptbBuilder.js'
export type { BuildActionPtbResult } from './ptbBuilder.js'
export type { RawActionGoal } from './extractor.js'
export type {
  PolicyState,
  PolicyAction,
  ScallopConfig,
  FieldError,
  ValidationResult,
  TranslateActionResult,
} from './types.js'
```

- [ ] **Step 4: Update `TranslateActionResult` to allow `config_missing`**

In `actionflow/src/types.ts`, update:

```ts
export type TranslateActionResult =
  | { ok: true; action: PolicyAction; ptbBytes: string }
  | { ok: false; errors: FieldError[] }
  | { ok: false; status: 'config_missing'; reason: string }
```

- [ ] **Step 5: Update the existing index.test.ts mocks for the new `action` field**

In the happy-path test, change the mocked `extractActionGoal` resolution and the `getMoveFunction` mock (which describes `record_action`'s parameter list — unaffected in shape, but the moved-to-real-call test still exercises `record_action` since `action: 'supply'` with `protocol: 'scallop'` now routes to Scallop, which would require Scallop-specific `getMoveFunction`/`getObjects` mocking this test doesn't have). To keep this test exercising the existing `record_action` fallback path (already covered for Scallop+supply by Task 3's unit tests and Task 4's new `config_missing` test above), change its protocol to a non-Scallop one:

```ts
it('returns action and ptbBytes on a full happy path', async () => {
  vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'deepbook', amount: 50, action: 'supply' })
  vi.mocked(fetchPolicyState).mockResolvedValue(validState({ allowedProtocols: ['deepbook'] }))

  // A real SuiJsonRpcClient is used (rather than a bare {} stub) because
  // tx.build({ client }) calls client.core.resolveTransactionPlugin(), which
  // is implemented on the real JSONRpcCoreClient but not present on a plain
  // object stub. We spy on the two network calls the resolver actually makes
  // (getObjects to resolve the shared PolicyObject reference, getMoveFunction
  // to resolve record_action's argument types) so no real network access occurs.
  const suiClient = new SuiJsonRpcClient({ url: 'http://localhost:9999', network: 'testnet' })
  vi.spyOn(suiClient.core, 'getObjects').mockResolvedValue({
    objects: [
      {
        objectId: POLICY_ID,
        version: '1',
        digest: '11'.repeat(32),
        owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        type: `${PACKAGE_ID}::policy::PolicyObject`,
      },
    ],
  } as never)
  vi.spyOn(suiClient.core, 'getMoveFunction').mockResolvedValue({
    function: {
      packageId: PACKAGE_ID,
      moduleName: 'policy',
      name: 'record_action',
      visibility: 'public',
      isEntry: true,
      typeParameters: [],
      parameters: [
        { reference: 'mutable', body: { $kind: 'datatype', datatype: { typeName: `${PACKAGE_ID}::policy::PolicyObject`, typeParameters: [] } } },
        { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
        { reference: null, body: { $kind: 'u64' } },
        { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
        { reference: 'immutable', body: { $kind: 'datatype', datatype: { typeName: '0x2::clock::Clock', typeParameters: [] } } },
      ],
      returns: [],
    },
  } as never)

  const result = await translateAction('deposit 50 into deepbook', {
    policyId: POLICY_ID,
    packageId: PACKAGE_ID,
    walrusBlobId: 'placeholder-blob',
    client: {} as Anthropic,
    suiClient,
  })

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.action.amount).toBe(50)
    expect(typeof result.ptbBytes).toBe('string')
    expect(result.ptbBytes.length).toBeGreaterThan(0)
  }
})
```

Also update the two remaining existing tests' `extractActionGoal` mocks to include `action: 'supply'`:

```ts
it('returns validation errors without building a PTB when budget is exceeded', async () => {
  vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 450, action: 'supply' })
  vi.mocked(fetchPolicyState).mockResolvedValue(validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 500 }))
  // ...unchanged body below
```

```ts
it('propagates a state-fetch failure as a thrown error', async () => {
  vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 50, action: 'supply' })
  vi.mocked(fetchPolicyState).mockRejectedValue(new Error('object not found'))
  // ...unchanged body below
```

- [ ] **Step 6: Run the actionflow test suite and confirm all pass**

```powershell
npm test
```

Expected: all test files pass.

- [ ] **Step 7: Build to confirm no type errors so far**

```powershell
npm run build
```

Expected: succeeds (no consumers outside `actionflow` are touched yet, so nothing else can be broken at this point).

- [ ] **Step 8: Commit**

```powershell
git add actionflow/src/index.ts actionflow/src/types.ts actionflow/src/index.test.ts
git commit -m "feat: route translateAction through buildActionPtb"
```

---

### Task 5: PolicyLoop declares `action: 'supply'` on its decision

**Files:**
- Modify: `policyloop/src/decision.ts`
- Test: `policyloop/src/decision.test.ts`

**Interfaces:**
- Produces: `PolicyDecision`'s `propose` variant gains `action: 'supply'`

- [ ] **Step 1: Update the decision tests**

In `policyloop/src/decision.test.ts`, update every `propose` expectation to include `action: 'supply'`:

```ts
it('does not treat nowMs equal to expiresAtMs as expired', () => {
  const state = baseState({ expiresAtMs: 1000, maxTotalBudget: 100, spentTotal: 0, maxSingleTx: 50 })
  expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 50, action: 'supply' })
})
```

```ts
it('proposes the first allowed protocol capped at maxSingleTx', () => {
  const state = baseState({ maxTotalBudget: 1000, spentTotal: 0, maxSingleTx: 100, allowedProtocols: ['scallop', 'navi'] })
  expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 100, action: 'supply' })
})
```

```ts
it('caps the proposed amount at the remaining budget when it is smaller than maxSingleTx', () => {
  const state = baseState({ maxTotalBudget: 1000, spentTotal: 970, maxSingleTx: 100 })
  expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 30, action: 'supply' })
})
```

- [ ] **Step 2: Run the decision tests and confirm the updated ones fail**

```powershell
npm test -- decision.test.ts
```

Expected: the three updated tests FAIL — actual results are missing the `action` key.

- [ ] **Step 3: Implement**

In `policyloop/src/decision.ts`:

```ts
import type { PolicyState } from 'actionflow'

export type PolicyDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'propose'; protocol: string; amount: number; action: 'supply' }

export function decidePolicyAction(state: PolicyState, nowMs: number): PolicyDecision {
  if (state.paused) {
    return { kind: 'skip', reason: 'policy is paused' }
  }
  if (state.revoked) {
    return { kind: 'skip', reason: 'policy is revoked' }
  }
  if (nowMs > state.expiresAtMs) {
    return { kind: 'skip', reason: `policy expired at ${state.expiresAtMs}` }
  }
  if (state.spentTotal >= state.maxTotalBudget) {
    return { kind: 'skip', reason: 'budget exhausted' }
  }
  if (state.allowedProtocols.length === 0) {
    return { kind: 'skip', reason: 'no allowed protocols' }
  }

  return {
    kind: 'propose',
    protocol: state.allowedProtocols[0],
    amount: Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx),
    action: 'supply',
  }
}
```

- [ ] **Step 4: Run the decision tests and confirm all pass**

```powershell
npm test -- decision.test.ts
```

Expected: all tests passed, 0 failed.

- [ ] **Step 5: Commit**

```powershell
git add policyloop/src/decision.ts policyloop/src/decision.test.ts
git commit -m "feat: declare supply action on PolicyLoop's proposed decision"
```

---

### Task 6: AgentRunner types gain `ScallopSuiSuppliedEvent` and a discriminated `RunActionResult`

**Files:**
- Modify: `agentrunner/src/types.ts`

**Interfaces:**
- Consumes: `ScallopConfig` (Task 3, from `actionflow`)
- Produces: `ScallopSuiSuppliedEvent`, `RunActionResult` success variants discriminated by `eventKind`, `RunActionOptions.scallop?: ScallopConfig`

This task only changes type declarations (no behavior yet — `submitter.ts` is updated in Task 7). There is no meaningful failing test for a type-only change in a file with no logic; this task is verified by the build step.

- [ ] **Step 1: Update `agentrunner/src/types.ts`**

```ts
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { FieldError, ScallopConfig, TranslateActionOptions } from 'actionflow'

export interface ActionRecordedEvent {
  policyId: string
  agent: string
  protocolId: string
  amount: string
  spentTotal: string
  walrusBlobId: string
  timestampMs: string
}

export interface ScallopSuiSuppliedEvent {
  policyId: string
  agent: string
  amount: string
  spentTotal: string
  vaultBalance: string
  scallopPositionBalance: string
  walrusBlobId: string
  timestampMs: string
}

export type RunActionResult =
  | { ok: true; status: 'succeeded'; digest: string; eventKind: 'action_recorded'; event: ActionRecordedEvent }
  | { ok: true; status: 'succeeded'; digest: string; eventKind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }
  | { ok: false; status: 'validation_failed'; errors: FieldError[] }
  | { ok: false; status: 'config_missing'; reason: string }
  | { ok: false; status: 'simulation_failed'; reason: string }
  | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
  | { ok: false; status: 'event_missing'; digest: string }
  | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }

export interface RunActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  scallop?: ScallopConfig
  client?: TranslateActionOptions['client']
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}
```

- [ ] **Step 2: Commit**

This leaves `submitter.ts` and `index.ts` referencing the old shapes until Tasks 7–8; that's fine under Vitest (no typecheck), and `npm run build` isn't run again until those tasks land.

```powershell
git add agentrunner/src/types.ts
git commit -m "feat: add ScallopSuiSuppliedEvent and discriminate RunActionResult"
```

---

### Task 7: `submitTransaction` recognizes both `ActionRecorded` and `ScallopSuiSupplied` events

**Files:**
- Modify: `agentrunner/src/submitter.ts`
- Test: `agentrunner/src/submitter.test.ts`

**Interfaces:**
- Consumes: `ScallopSuiSuppliedEvent`, discriminated `RunActionResult` (Task 6)
- Produces: `submitTransaction` returns `eventKind: 'scallop_sui_supplied'` for a `ScallopSuiSupplied` event, `eventKind: 'action_recorded'` for an `ActionRecorded` event

- [ ] **Step 1: Write the failing test**

In `agentrunner/src/submitter.test.ts`, add a Scallop event fixture and a new happy-path test, and update the existing happy-path assertion for the `eventKind` field:

```ts
const SCALLOP_SUI_SUPPLIED_TYPE = '0x' + '11'.repeat(32) + '::policy::ScallopSuiSupplied'

function scallopSuiSuppliedEvent() {
  return {
    type: SCALLOP_SUI_SUPPLIED_TYPE,
    parsedJson: {
      policy_id: '0xpolicy',
      agent: '0xagent',
      amount: '75',
      spent_total: '175',
      vault_balance: '425',
      scallop_position_balance: '75',
      walrus_blob_id: Array.from(new TextEncoder().encode('blob-id')),
      timestamp_ms: '1700000000000',
    },
  }
}
```

```ts
it('returns succeeded with a parsed event on the full happy path', async () => {
  const dryRunTransactionBlock = vi.fn().mockResolvedValue(successDryRun())
  const signAndExecuteTransaction = vi.fn().mockResolvedValue({
    digest: 'digest1',
    effects: { status: { status: 'success' } },
    events: [actionRecordedEvent()],
  })

  const result = await submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.eventKind).toBe('action_recorded')
    expect(result.digest).toBe('digest1')
    if (result.eventKind === 'action_recorded') {
      expect(result.event.amount).toBe('50')
      expect(result.event.protocolId).toBe('scallop')
      expect(result.event.walrusBlobId).toBe('blob-id')
    }
  }
})

it('returns succeeded with a parsed ScallopSuiSupplied event when that event is emitted instead', async () => {
  const dryRunTransactionBlock = vi.fn().mockResolvedValue(successDryRun())
  const signAndExecuteTransaction = vi.fn().mockResolvedValue({
    digest: 'digest5',
    effects: { status: { status: 'success' } },
    events: [scallopSuiSuppliedEvent()],
  })

  const result = await submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))

  expect(result.ok).toBe(true)
  if (result.ok) {
    expect(result.eventKind).toBe('scallop_sui_supplied')
    expect(result.digest).toBe('digest5')
    if (result.eventKind === 'scallop_sui_supplied') {
      expect(result.event.amount).toBe('75')
      expect(result.event.vaultBalance).toBe('425')
      expect(result.event.scallopPositionBalance).toBe('75')
      expect(result.event.walrusBlobId).toBe('blob-id')
    }
  }
})
```

- [ ] **Step 2: Run the submitter tests and confirm the new ones fail**

```powershell
npm test -- submitter.test.ts
```

Expected: FAIL — `result.eventKind` is `undefined` (not yet implemented), and the `ScallopSuiSupplied` event isn't recognized at all (falls through to `event_missing`).

- [ ] **Step 3: Implement the dual event parser**

Replace `agentrunner/src/submitter.ts`:

```ts
import type { Transaction } from '@mysten/sui/transactions'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { ActionRecordedEvent, RunActionResult, ScallopSuiSuppliedEvent } from './types.js'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS)
      }
    }
  }
  throw lastError
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ParsedEvent =
  | { kind: 'action_recorded'; event: ActionRecordedEvent }
  | { kind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }

function parseActionRecordedEvent(fields: Record<string, unknown>): ActionRecordedEvent {
  return {
    policyId: String(fields.policy_id),
    agent: String(fields.agent),
    protocolId: Buffer.from(fields.protocol_id as number[]).toString('utf8'),
    amount: String(fields.amount),
    spentTotal: String(fields.spent_total),
    walrusBlobId: Buffer.from(fields.walrus_blob_id as number[]).toString('utf8'),
    timestampMs: String(fields.timestamp_ms),
  }
}

function parseScallopSuiSuppliedEvent(fields: Record<string, unknown>): ScallopSuiSuppliedEvent {
  return {
    policyId: String(fields.policy_id),
    agent: String(fields.agent),
    amount: String(fields.amount),
    spentTotal: String(fields.spent_total),
    vaultBalance: String(fields.vault_balance),
    scallopPositionBalance: String(fields.scallop_position_balance),
    walrusBlobId: Buffer.from(fields.walrus_blob_id as number[]).toString('utf8'),
    timestampMs: String(fields.timestamp_ms),
  }
}

function parseEvent(events: { type: string; parsedJson: unknown }[]): ParsedEvent | undefined {
  const scallopEvent = events.find((e) => e.type.endsWith('::policy::ScallopSuiSupplied'))
  if (scallopEvent) {
    return { kind: 'scallop_sui_supplied', event: parseScallopSuiSuppliedEvent(scallopEvent.parsedJson as Record<string, unknown>) }
  }

  const actionEvent = events.find((e) => e.type.endsWith('::policy::ActionRecorded'))
  if (actionEvent) {
    return { kind: 'action_recorded', event: parseActionRecordedEvent(actionEvent.parsedJson as Record<string, unknown>) }
  }

  return undefined
}

export async function submitTransaction(
  tx: Transaction,
  signer: Ed25519Keypair,
  suiClient: SuiJsonRpcClient,
): Promise<RunActionResult> {
  let prep: { bytes: Uint8Array; dryRun: Awaited<ReturnType<typeof suiClient.dryRunTransactionBlock>> }
  try {
    prep = await withRetry(async () => {
      const bytes = await tx.build({ client: suiClient })
      const dryRun = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
      return { bytes, dryRun }
    })
  } catch (error) {
    return { ok: false, status: 'submission_failed', stage: 'dry_run', reason: errorMessage(error) }
  }

  if (prep.dryRun.effects.status.status === 'failure') {
    return { ok: false, status: 'simulation_failed', reason: prep.dryRun.effects.status.error ?? 'unknown abort' }
  }

  let executeResult: Awaited<ReturnType<typeof suiClient.signAndExecuteTransaction>>
  try {
    executeResult = await withRetry(() =>
      suiClient.signAndExecuteTransaction({
        transaction: prep.bytes,
        signer,
        options: { showEffects: true, showEvents: true },
      }),
    )
  } catch (error) {
    return { ok: false, status: 'submission_failed', stage: 'execute', reason: errorMessage(error) }
  }

  const digest = executeResult.digest

  if (!executeResult.effects || executeResult.effects.status.status === 'failure') {
    return {
      ok: false,
      status: 'execution_aborted',
      digest,
      reason: executeResult.effects?.status.error ?? 'unknown abort',
    }
  }

  const parsed = parseEvent(executeResult.events ?? [])
  if (!parsed) {
    return { ok: false, status: 'event_missing', digest }
  }

  if (parsed.kind === 'scallop_sui_supplied') {
    return { ok: true, status: 'succeeded', digest, eventKind: 'scallop_sui_supplied', event: parsed.event }
  }
  return { ok: true, status: 'succeeded', digest, eventKind: 'action_recorded', event: parsed.event }
}
```

- [ ] **Step 4: Run the submitter tests and confirm all pass**

```powershell
npm test -- submitter.test.ts
```

Expected: all tests passed, 0 failed.

- [ ] **Step 5: Run the full agentrunner suite**

```powershell
npm test
```

Expected: `submitter.test.ts` passes; `index.test.ts` may still reference the pre-Task-6 result shape and is updated next in Task 8 (Vitest's no-typecheck transform means this does not fail the run yet).

- [ ] **Step 6: Commit**

```powershell
git add agentrunner/src/submitter.ts agentrunner/src/submitter.test.ts
git commit -m "feat: parse ScallopSuiSupplied alongside ActionRecorded"
```

---

### Task 8: Thread Scallop config through `runAction` and the AgentRunner CLI

**Files:**
- Modify: `agentrunner/src/index.ts`
- Modify: `agentrunner/bin/agentrunner.ts`
- Test: `agentrunner/src/index.test.ts`

**Interfaces:**
- Consumes: `RunActionOptions.scallop` (Task 6), `TranslateActionOptions.scallop` (Task 4)
- Produces: `runAction` passes `opts.scallop` through to `translateAction`; CLI reads `SCALLOP_VERSION_OBJECT_ID`/`SCALLOP_MARKET_OBJECT_ID`/optional initial-shared-version env vars

- [ ] **Step 1: Update the index.test.ts happy-path event fixture and add a config_missing passthrough test**

In `agentrunner/src/index.test.ts`, update the existing happy-path test's mocked `submitTransaction` resolution to the new discriminated shape, and add a new test:

```ts
it('reconstructs the PTB, sets the signer as sender, and delegates to submitTransaction on the happy path', async () => {
  const signer = Ed25519Keypair.generate()
  const ptbBytes = await new Transaction().build({ onlyTransactionKind: true })
  const base64Bytes = Buffer.from(ptbBytes).toString('base64')

  vi.mocked(translateAction).mockResolvedValue({
    ok: true,
    action: { policyId: POLICY_ID, protocol: 'scallop', amount: 50, action: 'supply' },
    ptbBytes: base64Bytes,
  })
  vi.mocked(submitTransaction).mockResolvedValue({
    ok: true,
    status: 'succeeded',
    digest: 'digest1',
    eventKind: 'action_recorded',
    event: {
      policyId: POLICY_ID,
      agent: signer.toSuiAddress(),
      protocolId: 'scallop',
      amount: '50',
      spentTotal: '150',
      walrusBlobId: 'blob',
      timestampMs: '1700000000000',
    },
  })

  const result = await runAction('deposit 50 into scallop', {
    policyId: POLICY_ID,
    packageId: PACKAGE_ID,
    walrusBlobId: 'blob',
    signer,
  })

  expect(result.ok).toBe(true)
  expect(submitTransaction).toHaveBeenCalledTimes(1)
  const [calledTx, calledSigner] = vi.mocked(submitTransaction).mock.calls[0]
  expect(calledSigner).toBe(signer)
  expect(calledTx.getData().sender).toBe(signer.toSuiAddress())
})

it('passes the scallop config through to translateAction', async () => {
  const signer = Ed25519Keypair.generate()
  vi.mocked(translateAction).mockResolvedValue({
    ok: false,
    status: 'config_missing',
    reason: 'scallop config required for scallop supply',
  })

  const scallop = { versionObjectId: '0xver', marketObjectId: '0xmkt' }
  const result = await runAction('deposit 50 into scallop', {
    policyId: POLICY_ID,
    packageId: PACKAGE_ID,
    walrusBlobId: 'blob',
    scallop,
    signer,
  })

  expect(result).toEqual({ ok: false, status: 'config_missing', reason: 'scallop config required for scallop supply' })
  expect(translateAction).toHaveBeenCalledWith(
    'deposit 50 into scallop',
    expect.objectContaining({ scallop }),
  )
  expect(submitTransaction).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run the index tests and confirm the new test fails**

```powershell
npm test -- index.test.ts
```

Expected: FAIL — `runAction` does not yet handle a `config_missing` result from `translateAction` (it currently assumes `ok: false` always means `validation_failed`-shaped, and does not forward `opts.scallop`).

- [ ] **Step 3: Update `runAction`**

Replace `agentrunner/src/index.ts`:

```ts
import { translateAction } from 'actionflow'
import type { TranslateActionOptions } from 'actionflow'
import { Transaction } from '@mysten/sui/transactions'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { loadAgentKeypair } from './signer.js'
import { submitTransaction } from './submitter.js'
import type { RunActionOptions, RunActionResult } from './types.js'

export async function runAction(goal: string, opts: RunActionOptions): Promise<RunActionResult> {
  const suiClient = opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

  const translateOpts: TranslateActionOptions = {
    policyId: opts.policyId,
    packageId: opts.packageId,
    walrusBlobId: opts.walrusBlobId,
    scallop: opts.scallop,
    client: opts.client,
    suiClient,
  }

  const translated = await translateAction(goal, translateOpts)
  if (!translated.ok) {
    return translated
  }

  const signer = opts.signer ?? loadAgentKeypair()
  const tx = Transaction.fromKind(translated.ptbBytes)
  tx.setSender(signer.toSuiAddress())

  return submitTransaction(tx, signer, suiClient)
}

export { loadAgentKeypair } from './signer.js'
export { submitTransaction } from './submitter.js'
export type { ActionRecordedEvent, RunActionOptions, RunActionResult, ScallopSuiSuppliedEvent } from './types.js'
```

Note: `translated` (when `!translated.ok`) is either `{ ok: false; errors: FieldError[] }` (from `validateAction`, missing a `status` field) or `{ ok: false; status: 'config_missing'; reason: string }`. `RunActionResult`'s failure variant for validation is `{ ok: false; status: 'validation_failed'; errors: FieldError[] }` — it has a `status` field that the raw `ValidationResult` failure shape lacks. Returning `translated` directly when it lacks `status` would silently produce a result without `status: 'validation_failed'`. Fix this by checking explicitly:

```ts
  const translated = await translateAction(goal, translateOpts)
  if (!translated.ok) {
    if ('status' in translated) {
      return translated
    }
    return { ok: false, status: 'validation_failed', errors: translated.errors }
  }
```

Use this corrected block in place of the simpler `if (!translated.ok) { return translated }` above.

- [ ] **Step 4: Run the index tests and confirm all pass**

```powershell
npm test -- index.test.ts
```

Expected: all tests passed, 0 failed.

- [ ] **Step 5: Run the full agentrunner suite and build**

```powershell
npm test
npm run build
```

Expected: all tests pass; build succeeds with no type errors.

- [ ] **Step 6: Update the AgentRunner CLI**

In `agentrunner/bin/agentrunner.ts`, add Scallop env var reads (optional — only required if a goal actually resolves to a Scallop supply) and pass them through, and update the success log to branch on `eventKind`:

```ts
#!/usr/bin/env node
import { runAction } from '../src/index.js'

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

async function main() {
  const goal = process.argv.slice(2).join(' ')
  if (!goal) {
    console.error('Usage: agentrunner "<goal text>"')
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

  if (!process.env.AGENTRUNNER_PRIVATE_KEY) {
    console.error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
    process.exit(1)
  }

  const result = await runAction(goal, { policyId, packageId, walrusBlobId, scallop: readScallopConfig() })

  switch (result.status) {
    case 'succeeded':
      console.log(result.eventKind === 'scallop_sui_supplied' ? 'Scallop SUI supply recorded on-chain:' : 'Action recorded on-chain:')
      console.log(JSON.stringify(result.event, null, 2))
      console.log(`\nDigest: ${result.digest}`)
      return
    case 'validation_failed':
      console.error('Could not build an action from this goal:')
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

- [ ] **Step 7: Build to confirm the CLI compiles**

```powershell
npm run build
```

Expected: succeeds.

- [ ] **Step 8: Commit**

```powershell
git add agentrunner/src/index.ts agentrunner/src/index.test.ts agentrunner/bin/agentrunner.ts
git commit -m "feat: thread Scallop config through runAction and the CLI"
```

---

### Task 9: Wire PolicyLoop to `buildActionPtb` and its CLI

**Files:**
- Modify: `policyloop/src/index.ts`
- Modify: `policyloop/bin/policyloop.ts`
- Test: `policyloop/src/index.test.ts`

**Interfaces:**
- Consumes: `buildActionPtb`, `ScallopConfig` (Task 3/4), `RunActionResult` discriminated union (Task 6)
- Produces: `PolicyLoopOptions.scallop?: ScallopConfig`; `runPolicyCycle` calls `buildActionPtb` and propagates `config_missing`

- [ ] **Step 1: Update the index.test.ts mocks and add new tests**

In `policyloop/src/index.test.ts`, replace the `vi.mock('actionflow', ...)` to mock `buildActionPtb` instead of `buildRecordActionPtb`, update imports, and update/add tests:

```ts
vi.mock('actionflow', () => ({
  fetchPolicyState: vi.fn(),
  validateAction: vi.fn(),
  buildActionPtb: vi.fn(),
}))

vi.mock('agentrunner', () => ({
  loadAgentKeypair: vi.fn(),
  submitTransaction: vi.fn(),
}))

import { fetchPolicyState, validateAction, buildActionPtb } from 'actionflow'
import { submitTransaction } from 'agentrunner'
import { runPolicyCycle } from './index.js'
```

```ts
it('returns skipped without calling validateAction or submitTransaction when the policy is paused', async () => {
  vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState({ paused: true }))
  const signer = Ed25519Keypair.generate()

  const result = await runPolicyCycle({
    policyId: POLICY_ID,
    packageId: PACKAGE_ID,
    walrusBlobId: 'blob',
    signer,
  })

  expect(result).toEqual({ ok: true, status: 'skipped', reason: 'policy is paused' })
  expect(validateAction).not.toHaveBeenCalled()
  expect(buildActionPtb).not.toHaveBeenCalled()
  expect(submitTransaction).not.toHaveBeenCalled()
})

it('returns validation_failed when validateAction rejects the proposed action', async () => {
  vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
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

  expect(result).toEqual({ ok: false, status: 'config_missing', reason: 'scallop config required for scallop supply' })
  expect(submitTransaction).not.toHaveBeenCalled()
})

it('builds the PTB, sets the signer as sender, and delegates to submitTransaction on the happy path', async () => {
  const signer = Ed25519Keypair.generate()
  vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
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
```

- [ ] **Step 2: Run the index tests and confirm the new/changed ones fail**

```powershell
npm test -- index.test.ts
```

Expected: FAIL — `runPolicyCycle` still imports and calls `buildRecordActionPtb`, which the mock no longer provides, and does not handle a `config_missing` result.

- [ ] **Step 3: Update `runPolicyCycle`**

Replace `policyloop/src/index.ts`:

```ts
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fetchPolicyState, validateAction, buildActionPtb } from 'actionflow'
import type { ScallopConfig } from 'actionflow'
import { loadAgentKeypair, submitTransaction } from 'agentrunner'
import type { RunActionResult } from 'agentrunner'
import { decidePolicyAction } from './decision.js'

export interface PolicyLoopOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  scallop?: ScallopConfig
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}

export type PolicyLoopResult =
  | { ok: true; status: 'skipped'; reason: string }
  | RunActionResult

export async function runPolicyCycle(opts: PolicyLoopOptions): Promise<PolicyLoopResult> {
  const suiClient =
    opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })
  const nowMs = Date.now()

  const state = await fetchPolicyState(opts.policyId, suiClient)
  const decision = decidePolicyAction(state, nowMs)

  if (decision.kind === 'skip') {
    return { ok: true, status: 'skipped', reason: decision.reason }
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

export { decidePolicyAction } from './decision.js'
export type { PolicyDecision } from './decision.js'
```

- [ ] **Step 4: Run the index tests and confirm all pass**

```powershell
npm test -- index.test.ts
```

Expected: all tests passed, 0 failed.

- [ ] **Step 5: Run the full policyloop suite and build**

```powershell
npm test
npm run build
```

Expected: all tests pass; build succeeds with no type errors.

- [ ] **Step 6: Update the PolicyLoop CLI**

In `policyloop/bin/policyloop.ts`:

```ts
#!/usr/bin/env node
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

  const result = await runPolicyCycle({ policyId, packageId, walrusBlobId, scallop: readScallopConfig() })

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

- [ ] **Step 7: Build to confirm the CLI compiles**

```powershell
npm run build
```

Expected: succeeds.

- [ ] **Step 8: Commit**

```powershell
git add policyloop/src/index.ts policyloop/src/index.test.ts policyloop/bin/policyloop.ts
git commit -m "feat: route PolicyLoop through buildActionPtb"
```

---

### Task 10: Full verification across all three packages

**Files:**
- Verify only — no source changes.

- [ ] **Step 1: Install and test actionflow**

```powershell
cd actionflow
npm test
npm run build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 2: Install and test agentrunner**

```powershell
cd ../agentrunner
npm test
npm run build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 3: Install and test policyloop**

```powershell
cd ../policyloop
npm test
npm run build
```

Expected: all tests pass; build succeeds.

- [ ] **Step 4: Verify scope**

From the repository root:

```powershell
git diff --name-only main...HEAD
```

Expected changed scope: only files under `actionflow/`, `agentrunner/`, `policyloop/`, and the spec/plan docs under `docs/superpowers/`. No changes to `nexus_agent_wallet/`, `intentflow/`, or `Nexus.md`.

- [ ] **Step 5: Inspect the final commit series**

```powershell
git log --oneline main..HEAD
git status --short
```

Expected: ten feature/doc commits from Tasks 1–9 plus the spec/plan docs commits; worktree clean.
