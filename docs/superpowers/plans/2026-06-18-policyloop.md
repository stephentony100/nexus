# PolicyLoop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `policyloop/`, a new package that decides whether to act on a policy and, if so, drives the existing ActionFlow validate/build and AgentRunner sign/submit functions to do it — closing AgentRunner's deferred "what decides when to call `runAction`" gap.

**Architecture:** A pure decision function (`decidePolicyAction`) inspects a `PolicyState` and returns skip-or-propose. A thin orchestrator (`runPolicyCycle`) wires that decision into ActionFlow's `fetchPolicyState`/`validateAction`/`buildRecordActionPtb` and AgentRunner's `loadAgentKeypair`/`submitTransaction`, passing the `Transaction` object straight through with no base64 round-trip. A single-shot CLI runs one cycle and exits, for invocation by an external scheduler.

**Tech Stack:** TypeScript (NodeNext modules, ES2022 target), vitest, `@mysten/sui`, local `file:` dependencies on `actionflow` and `agentrunner` (both must already be built — their compiled `dist/` is what PolicyLoop imports).

## Global Constraints

- Zero changes to `actionflow/` or `agentrunner/` — both already export everything needed.
- No base64/PTB byte round-trip — `buildRecordActionPtb` returns a `Transaction` object, pass it directly to `submitTransaction`.
- No dependency on `@anthropic-ai/sdk` — PolicyLoop never touches an Anthropic client.
- `decidePolicyAction(state: PolicyState, nowMs: number): PolicyDecision` is pure — no I/O, no `Date.now()` inside it.
- `runPolicyCycle` captures exactly one `const nowMs = Date.now()` and passes that same value to both `decidePolicyAction` and `validateAction`.
- Decision check ordering (mirrors `validateAction`'s own ordering): paused → revoked → expired → budget exhausted → empty allowed protocols → propose.
- `PolicyDecision` uses ActionFlow's existing convention: `protocol: string`, `amount: number` (not `protocolId`/string).
- CLI reuses AgentRunner's exact 4 env var names (`ACTIONFLOW_POLICY_ID`, `ACTIONFLOW_PACKAGE_ID`, `ACTIONFLOW_WALRUS_BLOB_ID`, `AGENTRUNNER_PRIVATE_KEY`), all checked upfront before calling `runPolicyCycle`. No goal argument.
- CLI exits 0 for `succeeded`/`skipped`, exits 1 for any other status.
- Package lives at `policyloop/`, sibling to `actionflow/`, `agentrunner/`, `intentflow/`, with tooling config (tsconfig.json, vitest.config.ts, .gitignore) copied byte-for-byte from `agentrunner/`.

---

## File Structure

- `policyloop/package.json` — deps on `actionflow` (file:), `agentrunner` (file:), `@mysten/sui`; devDeps mirror agentrunner's.
- `policyloop/tsconfig.json`, `policyloop/vitest.config.ts`, `policyloop/.gitignore` — copied byte-for-byte from `agentrunner/`.
- `policyloop/src/decision.ts` — `decidePolicyAction` + `PolicyDecision` type. The only new business logic in this package.
- `policyloop/src/decision.test.ts` — full coverage of the decision ordering and boundary cases.
- `policyloop/src/index.ts` — `runPolicyCycle` + `PolicyLoopOptions`/`PolicyLoopResult` types. Orchestration only.
- `policyloop/src/index.test.ts` — mocks `actionflow` and `agentrunner`, verifies wiring.
- `policyloop/bin/policyloop.ts` — single-cycle CLI.
- `policyloop/README.md` — setup/usage, mirroring `agentrunner/README.md`.

---

### Task 1: Package scaffolding + `decidePolicyAction`

**Files:**
- Create: `policyloop/package.json`
- Create: `policyloop/tsconfig.json`
- Create: `policyloop/vitest.config.ts`
- Create: `policyloop/.gitignore`
- Create: `policyloop/src/decision.ts`
- Test: `policyloop/src/decision.test.ts`

**Interfaces:**
- Consumes: `PolicyState` type from `actionflow` (`{agent: string, maxTotalBudget: number, spentTotal: number, maxSingleTx: number, allowedProtocols: string[], expiresAtMs: number, paused: boolean, revoked: boolean}`).
- Produces: `PolicyDecision` type and `decidePolicyAction(state: PolicyState, nowMs: number): PolicyDecision` — consumed by Task 2's `runPolicyCycle`.

- [ ] **Step 1: Create the package scaffolding files**

`policyloop/package.json`:

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

`policyloop/tsconfig.json`:

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

`policyloop/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
})
```

`policyloop/.gitignore`:

```
node_modules
dist
```

- [ ] **Step 2: Build actionflow and agentrunner, then install policyloop's dependencies**

Run:
```bash
cd actionflow && npm install && npm run build
cd ../agentrunner && npm install && npm run build
cd ../policyloop && npm install
```
Expected: all three complete with exit code 0. `actionflow/dist` and `agentrunner/dist` must exist before `policyloop`'s `file:` dependencies resolve to anything usable.

- [ ] **Step 3: Write the failing tests for `decidePolicyAction`**

`policyloop/src/decision.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import type { PolicyState } from 'actionflow'
import { decidePolicyAction } from './decision.js'

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

describe('decidePolicyAction', () => {
  it('skips when paused', () => {
    const state = baseState({ paused: true })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is paused' })
  })

  it('skips when revoked', () => {
    const state = baseState({ revoked: true })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is revoked' })
  })

  it('skips when expired', () => {
    const state = baseState({ expiresAtMs: 500 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy expired at 500' })
  })

  it('does not treat nowMs equal to expiresAtMs as expired', () => {
    const state = baseState({ expiresAtMs: 1000, maxTotalBudget: 100, spentTotal: 0, maxSingleTx: 50 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 50 })
  })

  it('skips when budget is exhausted', () => {
    const state = baseState({ spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'budget exhausted' })
  })

  it('skips when there are no allowed protocols', () => {
    const state = baseState({ allowedProtocols: [] })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'no allowed protocols' })
  })

  it('proposes the first allowed protocol capped at maxSingleTx', () => {
    const state = baseState({ maxTotalBudget: 1000, spentTotal: 0, maxSingleTx: 100, allowedProtocols: ['scallop', 'navi'] })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 100 })
  })

  it('caps the proposed amount at the remaining budget when it is smaller than maxSingleTx', () => {
    const state = baseState({ maxTotalBudget: 1000, spentTotal: 970, maxSingleTx: 100 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'propose', protocol: 'scallop', amount: 30 })
  })

  it('checks paused before revoked, expiry, and budget', () => {
    const state = baseState({ paused: true, revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is paused' })
  })

  it('checks revoked before expiry and budget', () => {
    const state = baseState({ revoked: true, expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy is revoked' })
  })

  it('checks expiry before budget exhaustion', () => {
    const state = baseState({ expiresAtMs: 0, spentTotal: 1000, maxTotalBudget: 1000 })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'policy expired at 0' })
  })

  it('checks budget exhaustion before empty allowed protocols', () => {
    const state = baseState({ spentTotal: 1000, maxTotalBudget: 1000, allowedProtocols: [] })
    expect(decidePolicyAction(state, 1000)).toEqual({ kind: 'skip', reason: 'budget exhausted' })
  })
})
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd policyloop && npx vitest run src/decision.test.ts`
Expected: FAIL — `./decision.js` cannot be found (module doesn't exist yet).

- [ ] **Step 5: Implement `decidePolicyAction`**

`policyloop/src/decision.ts`:

```typescript
import type { PolicyState } from 'actionflow'

export type PolicyDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'propose'; protocol: string; amount: number }

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
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd policyloop && npx vitest run src/decision.test.ts`
Expected: PASS (12/12).

- [ ] **Step 7: Type-check**

Run: `cd policyloop && npx tsc --noEmit -p .`
Expected: exit code 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add policyloop/package.json policyloop/tsconfig.json policyloop/vitest.config.ts policyloop/.gitignore policyloop/src/decision.ts policyloop/src/decision.test.ts
git commit -m "policyloop: scaffold package and add decidePolicyAction"
```

---

### Task 2: `runPolicyCycle` orchestration

**Files:**
- Create: `policyloop/src/index.ts`
- Test: `policyloop/src/index.test.ts`

**Interfaces:**
- Consumes: `decidePolicyAction`/`PolicyDecision` from Task 1 (`./decision.js`); `fetchPolicyState(policyId: string, client: SuiJsonRpcClient): Promise<PolicyState>`, `validateAction(raw: {protocol: string|null, amount: number|null}, state: PolicyState, nowMs: number, policyId: string): {ok: true, action: PolicyAction} | {ok: false, errors: FieldError[]}`, `buildRecordActionPtb(action: PolicyAction, walrusBlobId: string, packageId: string): Transaction` from `actionflow`; `loadAgentKeypair(): Ed25519Keypair`, `submitTransaction(tx: Transaction, signer: Ed25519Keypair, suiClient: SuiJsonRpcClient): Promise<RunActionResult>` and the `RunActionResult` type from `agentrunner`.
- Produces: `PolicyLoopOptions`, `PolicyLoopResult` types and `runPolicyCycle(opts: PolicyLoopOptions): Promise<PolicyLoopResult>` — consumed by Task 3's CLI.

- [ ] **Step 1: Write the failing tests for `runPolicyCycle`**

`policyloop/src/index.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyState } from 'actionflow'

vi.mock('actionflow', () => ({
  fetchPolicyState: vi.fn(),
  validateAction: vi.fn(),
  buildRecordActionPtb: vi.fn(),
}))

vi.mock('agentrunner', () => ({
  loadAgentKeypair: vi.fn(),
  submitTransaction: vi.fn(),
}))

import { fetchPolicyState, validateAction, buildRecordActionPtb } from 'actionflow'
import { submitTransaction } from 'agentrunner'
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
    expect(buildRecordActionPtb).not.toHaveBeenCalled()
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
    expect(buildRecordActionPtb).not.toHaveBeenCalled()
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('builds the PTB, sets the signer as sender, and delegates to submitTransaction on the happy path', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(validateAction).mockReturnValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 100 },
    })
    vi.mocked(buildRecordActionPtb).mockReturnValue(new Transaction())
    vi.mocked(submitTransaction).mockResolvedValue({
      ok: true,
      status: 'succeeded',
      digest: 'digest1',
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
    expect(buildRecordActionPtb).toHaveBeenCalledWith(
      { policyId: POLICY_ID, protocol: 'scallop', amount: 100 },
      'blob',
      PACKAGE_ID,
    )
    expect(submitTransaction).toHaveBeenCalledTimes(1)
    const [calledTx, calledSigner] = vi.mocked(submitTransaction).mock.calls[0]
    expect(calledSigner).toBe(signer)
    expect(calledTx.getData().sender).toBe(signer.toSuiAddress())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd policyloop && npx vitest run src/index.test.ts`
Expected: FAIL — `./index.js` cannot be found (module doesn't exist yet).

- [ ] **Step 3: Implement `runPolicyCycle`**

`policyloop/src/index.ts`:

```typescript
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fetchPolicyState, validateAction, buildRecordActionPtb } from 'actionflow'
import { loadAgentKeypair, submitTransaction } from 'agentrunner'
import type { RunActionResult } from 'agentrunner'
import { decidePolicyAction } from './decision.js'

export interface PolicyLoopOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
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
    { protocol: decision.protocol, amount: decision.amount },
    state,
    nowMs,
    opts.policyId,
  )
  if (!validated.ok) {
    return { ok: false, status: 'validation_failed', errors: validated.errors }
  }

  const tx = buildRecordActionPtb(validated.action, opts.walrusBlobId, opts.packageId)
  const signer = opts.signer ?? loadAgentKeypair()
  tx.setSender(signer.toSuiAddress())

  return submitTransaction(tx, signer, suiClient)
}

export { decidePolicyAction } from './decision.js'
export type { PolicyDecision } from './decision.js'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd policyloop && npx vitest run src/index.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Type-check and run the full suite**

Run: `cd policyloop && npx tsc --noEmit -p . && npx vitest run`
Expected: tsc exits 0; vitest reports 15/15 passing (12 from Task 1 + 3 from this task).

- [ ] **Step 6: Commit**

```bash
git add policyloop/src/index.ts policyloop/src/index.test.ts
git commit -m "policyloop: add runPolicyCycle orchestration"
```

---

### Task 3: CLI and README

**Files:**
- Create: `policyloop/bin/policyloop.ts`
- Create: `policyloop/README.md`

**Interfaces:**
- Consumes: `runPolicyCycle` and `PolicyLoopResult` from Task 2 (`../src/index.js`).
- Produces: a runnable CLI entry point (`npm run cli` / `tsx bin/policyloop.ts`). Nothing downstream depends on this.

- [ ] **Step 1: Implement the CLI**

`policyloop/bin/policyloop.ts`:

```typescript
#!/usr/bin/env node
import { runPolicyCycle } from '../src/index.js'

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

  const result = await runPolicyCycle({ policyId, packageId, walrusBlobId })

  switch (result.status) {
    case 'skipped':
      console.log(`Skipped: ${result.reason}`)
      return
    case 'succeeded':
      console.log('Action recorded on-chain:')
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

- [ ] **Step 2: Write the README**

`policyloop/README.md`:

```markdown
# PolicyLoop

Decides whether to act on a policy and, if so, drives ActionFlow's
validate/build and AgentRunner's sign/submit to do it — runs exactly one
decision cycle per invocation and exits.

v1 scope: a fixed, deterministic decision template — no real DeFi market
data, no AI reasoning. Each cycle re-fetches the policy's live on-chain
state and either skips (paused, revoked, expired, budget exhausted, no
allowed protocols) or proposes a deposit into the policy's first allowed
protocol, for the largest amount the remaining budget and per-transaction
limit allow. There is no daemon or internal scheduling — an external
scheduler (cron, hosted cron, etc.) is responsible for invoking this
repeatedly. See `docs/superpowers/specs/2026-06-18-policyloop-design.md`
for the full design.

## Setup

```bash
cd actionflow
npm install
npm run build
cd ../agentrunner
npm install
npm run build
cd ../policyloop
npm install
```

`actionflow` and `agentrunner` must both be built first — `policyloop`
depends on their compiled output (`actionflow/dist`, `agentrunner/dist`)
via local `file:` dependencies.

## Usage

```bash
export ACTIONFLOW_POLICY_ID=0x...        # the on-chain PolicyObject's ID
export ACTIONFLOW_PACKAGE_ID=0x...       # nexus_agent_wallet package address
export ACTIONFLOW_WALRUS_BLOB_ID=placeholder-blob-id   # opaque placeholder, no real Walrus integration yet
export AGENTRUNNER_PRIVATE_KEY=suiprivkey1...   # the policy's approved agent's key (sui keytool export format)
npm run cli
```

Prints `Skipped: <reason>` if the policy isn't actionable this cycle.
Otherwise prints the same outcomes as AgentRunner's CLI: the recorded
action's on-chain event and digest on success, or details specific to
where it failed (validation, simulation, execution abort, missing event,
submission failure). Exits 0 for `succeeded`/`skipped`, exits 1 on
anything else.

## Tests

```bash
npm test
```
```

- [ ] **Step 3: Manually verify the CLI's env var checks**

Run: `cd policyloop && npx tsx bin/policyloop.ts`
Expected: prints `Missing ACTIONFLOW_POLICY_ID environment variable` and exits 1 (no env vars set).

- [ ] **Step 4: Type-check and run the full suite one more time**

Run: `cd policyloop && npx tsc --noEmit -p . && npx vitest run`
Expected: tsc exits 0; vitest reports 15/15 passing.

- [ ] **Step 5: Commit**

```bash
git add policyloop/bin/policyloop.ts policyloop/README.md
git commit -m "policyloop: add single-cycle CLI and README"
```
