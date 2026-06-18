# AgentRunner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `agentrunner/`, a TypeScript package that signs and submits the unsigned Sui PTBs ActionFlow's `translateAction()` validates and constructs — turning a plain-English action goal into a real, executed on-chain `record_action` call.

**Architecture:** `runAction(goal, opts)` calls ActionFlow's `translateAction()` directly, then on success loads an `Ed25519Keypair` from an env var, reconstructs the PTB via `Transaction.fromKind()`, sets the agent as sender, dry-runs it, and (on a clean dry run) signs and executes it — parsing the resulting `ActionRecorded` event into a typed result. A small internal retry-with-backoff covers transient network/RPC failures only; on-chain abort content is never retried.

**Tech Stack:** TypeScript (NodeNext ESM), `@mysten/sui` (`Transaction.fromKind`, `SuiJsonRpcClient`, `Ed25519Keypair`), `actionflow` (as a local `file:` package dependency), `vitest`, `tsx` for the CLI.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-agentrunner-design.md` — follow exactly; this plan implements that design.
- New standalone package `agentrunner/`, sibling to `actionflow/`, `intentflow/`, `nexus_agent_wallet/`. Mirror `actionflow/`'s package layout and tooling versions exactly (see Task 1).
- `agentrunner` depends on `actionflow` as a normal local package dependency (`"actionflow": "file:../actionflow"`) and imports `translateAction`, `TranslateActionOptions`, `FieldError` from it. ActionFlow's own source is never modified by this plan.
- **Verified SDK fact (checked directly against the installed `@mysten/sui@2.19.0` source, not assumed):** `dryRunTransactionBlock({ transactionBlock })` and `signAndExecuteTransaction({ transaction, signer })` both accept either a base64 string or a raw `Uint8Array` for the transaction bytes. When `signAndExecuteTransaction`'s `transaction` argument is a `Uint8Array` (not a `Transaction` object), it skips rebuilding entirely and signs those exact bytes. Therefore: build the full transaction bytes **once**, during the dry-run step, and reuse those same bytes for execution — never rebuild for the execute call.
- Retry policy (fixed, not configurable in v1): **3 attempts, fixed 300ms delay between attempts**, applied only to the dry-run RPC call (including the `tx.build({ client })` resolution step that precedes it) and the execute RPC call. A successful RPC response whose *content* reports an on-chain failure (`effects.status.status === 'failure'`) is never retried — only a thrown/rejected error from the call itself is retried.
- No signing key encoding to invent: `AGENTRUNNER_PRIVATE_KEY` is the standard `suiprivkey1...` bech32 string `Ed25519Keypair.fromSecretKey()` already accepts natively (the same format Sui's own `sui keytool` exports).
- Every `u64` field surfaced in `ActionRecordedEvent` (`amount`, `spentTotal`, `timestampMs`) is typed `string`, not `number` or `bigint` — avoids both JS float precision loss and `JSON.stringify` incompatibility with `bigint`.
- Test runner: `vitest`. No real network calls, real keypairs with real funds, or real RPC connections in any test — `SuiJsonRpcClient` methods and `actionflow`'s `translateAction` are always mocked; test keypairs are freshly generated in-memory (`Ed25519Keypair.generate()`), never funded or persisted.

---

## File Structure

```
agentrunner/
  package.json
  tsconfig.json
  vitest.config.ts
  .gitignore
  bin/
    agentrunner.ts
  src/
    types.ts
    signer.ts
    signer.test.ts
    submitter.ts
    submitter.test.ts
    index.ts
    index.test.ts
  README.md
```

---

### Task 1: Package scaffolding and shared types

**Files:**
- Create: `agentrunner/package.json`
- Create: `agentrunner/tsconfig.json`
- Create: `agentrunner/vitest.config.ts`
- Create: `agentrunner/.gitignore`
- Create: `agentrunner/src/types.ts`

**Interfaces:**
- Produces: `ActionRecordedEvent`, `RunActionResult`, `RunActionOptions` — used by every later task.

- [ ] **Step 1: Build `actionflow` first (prerequisite — agentrunner depends on its compiled output)**

Run, from the repo root:
```bash
cd actionflow && npm install && npm run build && cd ..
```
Expected: completes with no errors; `actionflow/dist/src/index.js` now exists.

- [ ] **Step 2: Create `agentrunner/package.json`**

```json
{
  "name": "agentrunner",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/src/index.js",
  "types": "dist/src/index.d.ts",
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "cli": "tsx bin/agentrunner.ts"
  },
  "dependencies": {
    "actionflow": "file:../actionflow",
    "@anthropic-ai/sdk": "^0.104.2",
    "@mysten/sui": "^2.18.0"
  },
  "devDependencies": {
    "@types/node": "^25.9.3",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 3: Create `agentrunner/tsconfig.json`**

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

- [ ] **Step 4: Create `agentrunner/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

- [ ] **Step 5: Create `agentrunner/.gitignore`**

```
node_modules
dist
```

- [ ] **Step 6: Install dependencies**

Run: `cd agentrunner && npm install`
Expected: completes with no errors; `agentrunner/node_modules/actionflow` exists and contains a `dist/` directory (copied/linked from the just-built `actionflow/dist`).

- [ ] **Step 7: Create `agentrunner/src/types.ts`**

```typescript
import type Anthropic from '@anthropic-ai/sdk'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { FieldError } from 'actionflow'

export interface ActionRecordedEvent {
  policyId: string
  agent: string
  protocolId: string
  amount: string
  spentTotal: string
  walrusBlobId: string
  timestampMs: string
}

export type RunActionResult =
  | { ok: true; status: 'succeeded'; digest: string; event: ActionRecordedEvent }
  | { ok: false; status: 'validation_failed'; errors: FieldError[] }
  | { ok: false; status: 'simulation_failed'; reason: string }
  | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
  | { ok: false; status: 'event_missing'; digest: string }
  | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }

export interface RunActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  client?: Anthropic
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}
```

- [ ] **Step 8: Verify the package type-checks (no tests yet — this task only adds types)**

Run: `cd agentrunner && npx tsc --noEmit -p . --rootDir src`
Expected: exit code 0, no errors. (Use `--rootDir src` instead of bare `npx tsc -p .` until `bin/` exists in Task 5 — same TS5011 empty-glob workaround ActionFlow's own plan needed for the same reason.)

- [ ] **Step 9: Commit**

```bash
git add agentrunner/package.json agentrunner/tsconfig.json agentrunner/vitest.config.ts agentrunner/.gitignore agentrunner/src/types.ts
git commit -m "agentrunner: scaffold package and add shared types"
```

---

### Task 2: Signer

**Files:**
- Create: `agentrunner/src/signer.ts`
- Test: `agentrunner/src/signer.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `loadAgentKeypair(): Ed25519Keypair` — used by Task 4 (`index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `agentrunner/src/signer.test.ts`:

```typescript
import { afterEach, describe, expect, it } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { loadAgentKeypair } from './signer.js'

const ORIGINAL_ENV = process.env.AGENTRUNNER_PRIVATE_KEY

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.AGENTRUNNER_PRIVATE_KEY
  } else {
    process.env.AGENTRUNNER_PRIVATE_KEY = ORIGINAL_ENV
  }
})

describe('loadAgentKeypair', () => {
  it('throws a clear error when AGENTRUNNER_PRIVATE_KEY is unset', () => {
    delete process.env.AGENTRUNNER_PRIVATE_KEY
    expect(() => loadAgentKeypair()).toThrow(/AGENTRUNNER_PRIVATE_KEY/)
  })

  it('decodes a real exported secret key into a keypair with the matching address', () => {
    const generated = Ed25519Keypair.generate()
    process.env.AGENTRUNNER_PRIVATE_KEY = generated.getSecretKey()

    const loaded = loadAgentKeypair()

    expect(loaded.toSuiAddress()).toBe(generated.toSuiAddress())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd agentrunner && npx vitest run src/signer.test.ts`
Expected: FAIL — `signer.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `agentrunner/src/signer.ts`:

```typescript
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

export function loadAgentKeypair(): Ed25519Keypair {
  const secretKey = process.env.AGENTRUNNER_PRIVATE_KEY
  if (!secretKey) {
    throw new Error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
  }
  return Ed25519Keypair.fromSecretKey(secretKey)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd agentrunner && npx vitest run src/signer.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add agentrunner/src/signer.ts agentrunner/src/signer.test.ts
git commit -m "agentrunner: add signer (load agent keypair from env)"
```

---

### Task 3: Submitter

**Files:**
- Create: `agentrunner/src/submitter.ts`
- Test: `agentrunner/src/submitter.test.ts`

**Interfaces:**
- Consumes: `RunActionResult`, `ActionRecordedEvent` (Task 1).
- Produces: `submitTransaction(tx: Transaction, signer: Ed25519Keypair, suiClient: SuiJsonRpcClient): Promise<RunActionResult>` — used by Task 4 (`index.ts`).

- [ ] **Step 1: Write the failing tests**

Create `agentrunner/src/submitter.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@mysten/sui/transactions'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { submitTransaction } from './submitter.js'

const BYTES = new Uint8Array([1, 2, 3])
const SIGNER = {} as Ed25519Keypair
const ACTION_RECORDED_TYPE = '0x' + '11'.repeat(32) + '::policy::ActionRecorded'

function mockTx(): Transaction {
  return { build: vi.fn().mockResolvedValue(BYTES) } as unknown as Transaction
}

function successDryRun() {
  return { effects: { status: { status: 'success' as const } }, events: [] }
}

function failureDryRun(error: string) {
  return { effects: { status: { status: 'failure' as const, error } }, events: [] }
}

function actionRecordedEvent() {
  return {
    type: ACTION_RECORDED_TYPE,
    parsedJson: {
      policy_id: '0xpolicy',
      agent: '0xagent',
      protocol_id: Array.from(new TextEncoder().encode('scallop')),
      amount: '50',
      spent_total: '150',
      walrus_blob_id: Array.from(new TextEncoder().encode('blob-id')),
      timestamp_ms: '1700000000000',
    },
  }
}

function mockClient(
  dryRunTransactionBlock: ReturnType<typeof vi.fn>,
  signAndExecuteTransaction: ReturnType<typeof vi.fn>,
): SuiJsonRpcClient {
  return { dryRunTransactionBlock, signAndExecuteTransaction } as unknown as SuiJsonRpcClient
}

describe('submitTransaction', () => {
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
      expect(result.digest).toBe('digest1')
      expect(result.event.amount).toBe('50')
      expect(result.event.protocolId).toBe('scallop')
      expect(result.event.walrusBlobId).toBe('blob-id')
    }
  })

  it('returns simulation_failed when the dry run reports an on-chain abort, without ever calling execute', async () => {
    const dryRunTransactionBlock = vi.fn().mockResolvedValue(failureDryRun('MoveAbort: ENotAgent'))
    const signAndExecuteTransaction = vi.fn()

    const result = await submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))

    expect(result).toEqual({ ok: false, status: 'simulation_failed', reason: 'MoveAbort: ENotAgent' })
    expect(signAndExecuteTransaction).not.toHaveBeenCalled()
  })

  it('returns execution_aborted with the real digest when execution effects report failure', async () => {
    const dryRunTransactionBlock = vi.fn().mockResolvedValue(successDryRun())
    const signAndExecuteTransaction = vi.fn().mockResolvedValue({
      digest: 'digest2',
      effects: { status: { status: 'failure', error: 'MoveAbort: ETotalBudgetExceeded' } },
      events: [],
    })

    const result = await submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))

    expect(result).toEqual({
      ok: false,
      status: 'execution_aborted',
      digest: 'digest2',
      reason: 'MoveAbort: ETotalBudgetExceeded',
    })
  })

  it('returns event_missing when execution succeeds but no ActionRecorded event is found', async () => {
    const dryRunTransactionBlock = vi.fn().mockResolvedValue(successDryRun())
    const signAndExecuteTransaction = vi.fn().mockResolvedValue({
      digest: 'digest3',
      effects: { status: { status: 'success' } },
      events: [],
    })

    const result = await submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))

    expect(result).toEqual({ ok: false, status: 'event_missing', digest: 'digest3' })
  })

  it('retries a transient dry-run network failure and succeeds once it stops failing', async () => {
    vi.useFakeTimers()
    const dryRunTransactionBlock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(successDryRun())
    const signAndExecuteTransaction = vi.fn().mockResolvedValue({
      digest: 'digest4',
      effects: { status: { status: 'success' } },
      events: [actionRecordedEvent()],
    })

    const resultPromise = submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(300)
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(dryRunTransactionBlock).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('gives up after exhausting retries on a persistent dry-run network failure', async () => {
    vi.useFakeTimers()
    const dryRunTransactionBlock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    const signAndExecuteTransaction = vi.fn()

    const resultPromise = submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(300)
    const result = await resultPromise

    expect(result).toEqual({
      ok: false,
      status: 'submission_failed',
      stage: 'dry_run',
      reason: 'ECONNRESET',
    })
    expect(dryRunTransactionBlock).toHaveBeenCalledTimes(3)
    expect(signAndExecuteTransaction).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('retries a transient execute network failure and gives up with stage execute after exhausting retries', async () => {
    vi.useFakeTimers()
    const dryRunTransactionBlock = vi.fn().mockResolvedValue(successDryRun())
    const signAndExecuteTransaction = vi.fn().mockRejectedValue(new Error('timeout'))

    const resultPromise = submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(300)
    const result = await resultPromise

    expect(result).toEqual({
      ok: false,
      status: 'submission_failed',
      stage: 'execute',
      reason: 'timeout',
    })
    expect(signAndExecuteTransaction).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd agentrunner && npx vitest run src/submitter.test.ts`
Expected: FAIL — `submitter.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `agentrunner/src/submitter.ts`:

```typescript
import type { Transaction } from '@mysten/sui/transactions'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { ActionRecordedEvent, RunActionResult } from './types.js'

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

function parseActionRecordedEvent(events: { type: string; parsedJson: unknown }[]): ActionRecordedEvent | undefined {
  const event = events.find((e) => e.type.endsWith('::policy::ActionRecorded'))
  if (!event) return undefined

  const fields = event.parsedJson as Record<string, unknown>
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

  const event = parseActionRecordedEvent(executeResult.events ?? [])
  if (!event) {
    return { ok: false, status: 'event_missing', digest }
  }

  return { ok: true, status: 'succeeded', digest, event }
}
```

Note: `parseActionRecordedEvent` deliberately does not re-validate field types the way ActionFlow's `policyState.ts` does for a freshly-fetched chain object. This event was just emitted by `record_action` inside a transaction this same code built, signed, and successfully executed — the Move VM guarantees the emitted fields match the contract's declared types exactly, so there is no "wrong shape from an untrusted source" risk the way there is when fetching an arbitrary object by ID. The one real correctness concern here — the event not being found at all — is handled by the `event_missing` result.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd agentrunner && npx vitest run src/submitter.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
git add agentrunner/src/submitter.ts agentrunner/src/submitter.test.ts
git commit -m "agentrunner: add submitter (dry-run, retry, execute, parse ActionRecorded)"
```

---

### Task 4: Compose runAction

**Files:**
- Create: `agentrunner/src/index.ts`
- Test: `agentrunner/src/index.test.ts`

**Interfaces:**
- Consumes: `translateAction`, `TranslateActionOptions` (from `actionflow`); `loadAgentKeypair` (Task 2); `submitTransaction` (Task 3); `RunActionOptions`, `RunActionResult` (Task 1).
- Produces: `runAction(goal: string, opts: RunActionOptions): Promise<RunActionResult>` — used by Task 5 (CLI).

- [ ] **Step 1: Write the failing tests**

Create `agentrunner/src/index.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'

vi.mock('actionflow', () => ({
  translateAction: vi.fn(),
}))

vi.mock('./submitter.js', () => ({
  submitTransaction: vi.fn(),
}))

import { translateAction } from 'actionflow'
import { submitTransaction } from './submitter.js'
import { runAction } from './index.js'

const POLICY_ID = '0x' + 'aa'.repeat(32)
const PACKAGE_ID = '0x' + '11'.repeat(32)

describe('runAction', () => {
  it('returns validation_failed without ever calling submitTransaction', async () => {
    vi.mocked(translateAction).mockResolvedValue({
      ok: false,
      errors: [{ field: 'amount', reason: 'not specified in goal' }],
    })

    const result = await runAction('do something vague', {
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer: Ed25519Keypair.generate(),
    })

    expect(result).toEqual({
      ok: false,
      status: 'validation_failed',
      errors: [{ field: 'amount', reason: 'not specified in goal' }],
    })
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('reconstructs the PTB, sets the signer as sender, and delegates to submitTransaction on the happy path', async () => {
    const signer = Ed25519Keypair.generate()
    const ptbBytes = await new Transaction().build({ onlyTransactionKind: true })
    const base64Bytes = Buffer.from(ptbBytes).toString('base64')

    vi.mocked(translateAction).mockResolvedValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 50 },
      ptbBytes: base64Bytes,
    })
    vi.mocked(submitTransaction).mockResolvedValue({
      ok: true,
      status: 'succeeded',
      digest: 'digest1',
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
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd agentrunner && npx vitest run src/index.test.ts`
Expected: FAIL — `index.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `agentrunner/src/index.ts`:

```typescript
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
    client: opts.client,
    suiClient,
  }

  const translated = await translateAction(goal, translateOpts)
  if (!translated.ok) {
    return { ok: false, status: 'validation_failed', errors: translated.errors }
  }

  const signer = opts.signer ?? loadAgentKeypair()
  const tx = Transaction.fromKind(translated.ptbBytes)
  tx.setSender(signer.toSuiAddress())

  return submitTransaction(tx, signer, suiClient)
}

export { loadAgentKeypair } from './signer.js'
export { submitTransaction } from './submitter.js'
export type { ActionRecordedEvent, RunActionOptions, RunActionResult } from './types.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd agentrunner && npx vitest run src/index.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Run the full test suite**

Run: `cd agentrunner && npm test`
Expected: all test files pass (signer, submitter, index — 11 tests total).

- [ ] **Step 6: Commit**

```bash
git add agentrunner/src/index.ts agentrunner/src/index.test.ts
git commit -m "agentrunner: compose translateAction, signer, and submitter into runAction"
```

---

### Task 5: CLI entry point and README

**Files:**
- Create: `agentrunner/bin/agentrunner.ts`
- Create: `agentrunner/README.md`

**Interfaces:**
- Consumes: `runAction` (Task 4).
- Produces: nothing consumed by other tasks (terminal task).

- [ ] **Step 1: Create `agentrunner/bin/agentrunner.ts`**

```typescript
#!/usr/bin/env node
import { runAction } from '../src/index.js'

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

  const result = await runAction(goal, { policyId, packageId, walrusBlobId })

  switch (result.status) {
    case 'succeeded':
      console.log('Action recorded on-chain:')
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
    case 'simulation_failed':
      console.error(`Simulation rejected this action: ${result.reason}`)
      process.exit(1)
      return
    case 'execution_aborted':
      console.error(`Execution aborted on-chain (digest ${result.digest}): ${result.reason}`)
      process.exit(1)
      return
    case 'event_missing':
      console.error(`Execution reported success (digest ${result.digest}) but no ActionRecorded event was found`)
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

- [ ] **Step 2: Manually verify the no-args case**

Run: `cd agentrunner && npm run cli --`
Expected: prints `Usage: agentrunner "<goal text>"` to stderr and exits 1.

- [ ] **Step 3: Manually verify the missing-env-var case**

Run: `cd agentrunner && npm run cli -- "deposit 100 into scallop"`
Expected: prints `Missing ACTIONFLOW_POLICY_ID environment variable` to stderr and exits 1 (no real Claude/Sui/signing calls made, since every env check happens before any API call).

- [ ] **Step 4: Create `agentrunner/README.md`**

```markdown
# AgentRunner

Signs and submits the unsigned Sui PTBs that ActionFlow validates and builds,
calling `nexus_agent_wallet::policy::record_action` for real on a live network.

v1 scope: takes a plain-English action goal, runs it through ActionFlow's
`translateAction()`, then signs the result as the policy's approved agent,
dry-runs it, and submits it. This is the "can move real funds" boundary in
Nexus — ActionFlow itself never signs or submits anything. See
`docs/superpowers/specs/2026-06-18-agentrunner-design.md` for the full design.

**Note:** the agent's signing key is currently provisioned via a single
environment variable (`AGENTRUNNER_PRIVATE_KEY`) — a backend-controlled
stopgap until zkLogin/wallet integration exists. The agent's address must
hold enough SUI to pay gas for any submitted transaction.

## Setup

```bash
cd actionflow
npm install
npm run build
cd ../agentrunner
npm install
```

`actionflow` must be built first — `agentrunner` depends on its compiled
output (`actionflow/dist`) via a local `file:` dependency.

Requires `ANTHROPIC_API_KEY` in the environment (read automatically by the
Anthropic SDK, same as ActionFlow).

## Usage

```bash
export ACTIONFLOW_POLICY_ID=0x...        # the on-chain PolicyObject's ID
export ACTIONFLOW_PACKAGE_ID=0x...       # nexus_agent_wallet package address
export ACTIONFLOW_WALRUS_BLOB_ID=placeholder-blob-id   # opaque placeholder, no real Walrus integration yet
export AGENTRUNNER_PRIVATE_KEY=suiprivkey1...   # the policy's approved agent's key (sui keytool export format)
npm run cli -- "deposit 100 into scallop, yield looks better there"
```

Prints the recorded action's on-chain event and transaction digest on
success. On failure, prints details specific to where it failed:
validation errors (the goal couldn't be turned into a valid action), a
simulation rejection (an on-chain rule would have aborted — no gas spent),
an execution abort (rare: passed simulation but still aborted on
submission), a missing event (execution reported success but the expected
on-chain log entry wasn't found), or a submission failure (a network/RPC
problem talking to the chain). Exits 1 on anything but success.

## Tests

```bash
npm test
```
```

- [ ] **Step 5: Commit**

```bash
git add agentrunner/bin/agentrunner.ts agentrunner/README.md
git commit -m "agentrunner: add CLI entry point and usage docs"
```

---

## Self-Review Notes

- **Spec coverage:** Purpose/Scope → Task 1 (package, dependency on actionflow) + overall plan scope; Architecture's signer/reconstruct/dry-run/execute flow → Tasks 2-4; the 6-way result union and its rationale table → Task 1's types + Task 3's implementation; the verified `Uint8Array`-reuse SDK fact and the fixed retry policy → Global Constraints + Task 3; CLI → Task 5. Every Data Flow/Error Handling row in the spec has a corresponding test (validation passthrough in Task 4, dry-run network failure / simulation abort / execute network failure / execution abort / event-missing all in Task 3, missing-env-var config error in Task 2 and Task 5's manual verification).
- **Type consistency check:** `RunActionResult`, `ActionRecordedEvent`, and `RunActionOptions` are defined once in Task 1 and referenced identically (same field names, same `string` typing for u64 fields) in Tasks 3, 4, and 5 — no renaming drift.
- **No placeholders:** every step above contains complete, runnable code; no "TBD"/"similar to Task N" shortcuts. The one deliberate, explained simplification (no defensive type-guards in `parseActionRecordedEvent`, unlike ActionFlow's `policyState.ts`) is justified inline in Task 3 rather than left ambiguous.
