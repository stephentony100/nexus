# DeepBook Safety Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the silent bookkeeping fallback from `buildActionPtb` so that unsupported protocol/action pairs produce a hard error instead of a misleading on-chain `record_action` call.

**Architecture:** Defense in depth — the validator rejects known invalid business cases early (`deepbook + supply`), and the router refuses to build PTBs for any combo it has no implementation for. `buildRecordActionPtb` is renamed to `buildAuditOnlyRecordPtb` and removed from the routing path entirely.

**Tech Stack:** TypeScript ESM, Vitest, `@mysten/sui/transactions`. All packages are in `C:/Users/NT/Desktop/nexus/`. Tests run with `npx vitest run` inside each package.

## Global Constraints

- All local TypeScript imports use `.js` extension (ESM)
- No new dependencies
- `buildAuditOnlyRecordPtb` must remain exported — do not delete it
- `buildAuditOnlyRecordPtb` must not appear anywhere in `buildActionPtb`'s execution path
- The exact error message for the router: `no PTB builder for protocol "${action.protocol}" action "${action.action}"`
- The exact error message for the validator: `deepbook does not support 'supply'; use 'swap' or 'place_limit_order'`
- `unsupported_action` is a handled operational result in policyloop — it must never throw or trigger the daemon backoff path

---

### Task 1: Add `unsupported_action` to `BuildActionPtbResult` and `RunActionResult`

**Files:**
- Modify: `actionflow/src/ptbBuilder.ts`
- Modify: `agentrunner/src/types.ts`

**Interfaces:**
- Produces (used by Tasks 2 and 3):
  ```ts
  // actionflow/src/ptbBuilder.ts
  export type BuildActionPtbResult =
    | { ok: true; tx: Transaction }
    | { ok: false; status: 'config_missing'; reason: string }
    | { ok: false; status: 'unsupported_action'; reason: string }  // NEW

  // agentrunner/src/types.ts
  export type RunActionResult =
    | { ok: true; status: 'succeeded'; digest: string; eventKind: 'action_recorded'; event: ActionRecordedEvent }
    | { ok: true; status: 'succeeded'; digest: string; eventKind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }
    | { ok: false; status: 'validation_failed'; errors: FieldError[] }
    | { ok: false; status: 'config_missing'; reason: string }
    | { ok: false; status: 'unsupported_action'; reason: string }  // NEW
    | { ok: false; status: 'simulation_failed'; reason: string }
    | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
    | { ok: false; status: 'event_missing'; digest: string }
    | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }
  ```

- [ ] **Step 1: Add `unsupported_action` to `BuildActionPtbResult` in `actionflow/src/ptbBuilder.ts`**

  Find the current type (around line 100):
  ```ts
  export type BuildActionPtbResult =
    | { ok: true; tx: Transaction }
    | { ok: false; status: 'config_missing'; reason: string }
  ```
  Replace with:
  ```ts
  export type BuildActionPtbResult =
    | { ok: true; tx: Transaction }
    | { ok: false; status: 'config_missing'; reason: string }
    | { ok: false; status: 'unsupported_action'; reason: string }
  ```

- [ ] **Step 2: Add `unsupported_action` to `RunActionResult` in `agentrunner/src/types.ts`**

  Find the current union (around line 26). Add the new variant after `config_missing`:
  ```ts
  export type RunActionResult =
    | { ok: true; status: 'succeeded'; digest: string; eventKind: 'action_recorded'; event: ActionRecordedEvent }
    | { ok: true; status: 'succeeded'; digest: string; eventKind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }
    | { ok: false; status: 'validation_failed'; errors: FieldError[] }
    | { ok: false; status: 'config_missing'; reason: string }
    | { ok: false; status: 'unsupported_action'; reason: string }
    | { ok: false; status: 'simulation_failed'; reason: string }
    | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
    | { ok: false; status: 'event_missing'; digest: string }
    | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }
  ```

- [ ] **Step 3: Type-check both packages**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx tsc --noEmit
  ```
  Expected: zero errors in both.

- [ ] **Step 4: Commit**

  ```
  git add actionflow/src/ptbBuilder.ts agentrunner/src/types.ts
  git commit -m "feat: add unsupported_action status to BuildActionPtbResult and RunActionResult"
  ```

---

### Task 2: Rename `buildRecordActionPtb` → `buildAuditOnlyRecordPtb` and make `buildActionPtb` a strict router

**Files:**
- Modify: `actionflow/src/ptbBuilder.ts`
- Modify: `actionflow/src/ptbBuilder.test.ts`
- Modify: `actionflow/src/index.ts`

**Interfaces:**
- Consumes (from Task 1): `BuildActionPtbResult` now includes `unsupported_action`
- Produces:
  ```ts
  // actionflow/src/ptbBuilder.ts
  export function buildAuditOnlyRecordPtb(action: PolicyAction, walrusBlobId: string, packageId: string, policyInitialSharedVersion?: string | number): Transaction
  export function buildScallopSupplySuiPtb(action: PolicyAction, walrusBlobId: string, packageId: string, scallop: ScallopConfig, policyInitialSharedVersion?: string | number): Transaction
  export function buildActionPtb(action: PolicyAction, walrusBlobId: string, packageId: string, scallop: ScallopConfig | undefined, policyInitialSharedVersion?: string | number): BuildActionPtbResult
  ```

- [ ] **Step 1: Update `actionflow/src/ptbBuilder.test.ts` — replace the three stale tests and fix the import**

  Replace the entire file content with:
  ```ts
  import { describe, expect, it } from 'vitest'
  import { buildActionPtb, buildAuditOnlyRecordPtb, buildScallopSupplySuiPtb } from './ptbBuilder.js'
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

  describe('buildAuditOnlyRecordPtb', () => {
    it('adds exactly one moveCall targeting policy::record_action', () => {
      const tx = buildAuditOnlyRecordPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
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
      const tx = buildAuditOnlyRecordPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, 1)
      const bytes = await tx.build({ onlyTransactionKind: true })
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('throws when building without a client and without the policy object version', async () => {
      const tx = buildAuditOnlyRecordPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
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
    it('routes scallop + supply to buildScallopSupplySuiPtb', () => {
      const result = buildActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, SCALLOP_CONFIG, 1)
      expect(result.ok).toBe(true)
      if (result.ok) {
        const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
        if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
        expect(moveCalls[0].MoveCall.function).toBe('supply_sui')
      }
    })

    it('returns config_missing when scallop + supply has no scallop config', () => {
      const result = buildActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
      expect(result).toEqual({
        ok: false,
        status: 'config_missing',
        reason: 'scallop config required for scallop supply',
      })
    })

    it('returns unsupported_action for an unknown protocol', () => {
      const action: PolicyAction = { ...ACTION, protocol: 'navi' }
      const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
      expect(result).toEqual({
        ok: false,
        status: 'unsupported_action',
        reason: 'no PTB builder for protocol "navi" action "supply"',
      })
    })

    it('returns unsupported_action for deepbook + supply (regression: must not return a Transaction)', () => {
      const action: PolicyAction = { ...ACTION, protocol: 'deepbook' }
      const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
      expect(result).toEqual({
        ok: false,
        status: 'unsupported_action',
        reason: 'no PTB builder for protocol "deepbook" action "supply"',
      })
    })

    it('returns unsupported_action for scallop + withdraw (validator rejects this earlier, router is the safety net)', () => {
      const action: PolicyAction = { ...ACTION, action: 'withdraw' }
      const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
      expect(result).toEqual({
        ok: false,
        status: 'unsupported_action',
        reason: 'no PTB builder for protocol "scallop" action "withdraw"',
      })
    })
  })
  ```

- [ ] **Step 2: Run the tests — expect failures**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run src/ptbBuilder.test.ts
  ```
  Expected: FAIL — `buildAuditOnlyRecordPtb` not exported, deepbook and scallop+withdraw tests fail with wrong behavior.

- [ ] **Step 3: Rename `buildRecordActionPtb` → `buildAuditOnlyRecordPtb` in `actionflow/src/ptbBuilder.ts`**

  Change the function declaration (around line 7):
  ```ts
  // BEFORE
  export function buildRecordActionPtb(
  // AFTER
  export function buildAuditOnlyRecordPtb(
  ```

- [ ] **Step 4: Replace `buildActionPtb` router with strict implementation**

  Replace the `buildActionPtb` function body (starting around line 104):
  ```ts
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
    return {
      ok: false,
      status: 'unsupported_action',
      reason: `no PTB builder for protocol "${action.protocol}" action "${action.action}"`,
    }
  }
  ```

- [ ] **Step 5: Update re-export in `actionflow/src/index.ts`**

  Find the line:
  ```ts
  export { buildRecordActionPtb, buildScallopSupplySuiPtb, buildActionPtb } from './ptbBuilder.js'
  ```
  Replace with:
  ```ts
  export { buildAuditOnlyRecordPtb, buildScallopSupplySuiPtb, buildActionPtb } from './ptbBuilder.js'
  ```

- [ ] **Step 6: Run the tests — expect all to pass**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run src/ptbBuilder.test.ts
  ```
  Expected: all tests in the file pass.

- [ ] **Step 7: Run the full actionflow suite to check for regressions**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run
  ```
  Expected: all tests pass. If `index.test.ts` references `buildRecordActionPtb`, update it to `buildAuditOnlyRecordPtb`.

- [ ] **Step 8: Commit**

  ```
  git add actionflow/src/ptbBuilder.ts actionflow/src/ptbBuilder.test.ts actionflow/src/index.ts
  git commit -m "feat: rename buildRecordActionPtb to buildAuditOnlyRecordPtb and make buildActionPtb a strict router"
  ```

---

### Task 3: Validator — reject `deepbook + supply` explicitly

**Files:**
- Modify: `actionflow/src/validator.ts`
- Modify: `actionflow/src/validator.test.ts`

**Interfaces:**
- Consumes: `validateAction(raw, state, nowMs, policyId)` — signature unchanged
- Produces: `deepbook + supply` now returns `{ ok: false, errors: [{ field: 'action', reason: "deepbook does not support 'supply'; use 'swap' or 'place_limit_order'" }] }`

- [ ] **Step 1: Add the failing test to `actionflow/src/validator.test.ts`**

  After the existing `'rejects a scallop withdraw as not yet supported on-chain'` test (around line 151), add:
  ```ts
  it('rejects deepbook + supply as an invalid action for this protocol', () => {
    const result = validateAction(
      validRaw({ protocol: 'deepbook', action: 'supply' }),
      validState({ allowedProtocols: ['deepbook'] }),
      NOW,
      POLICY_ID,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'action',
        reason: "deepbook does not support 'supply'; use 'swap' or 'place_limit_order'",
      })
    }
  })
  ```

  Also update the existing test `'accepts a withdraw action for a non-scallop protocol'` — it still passes, no change needed (deepbook + withdraw is not rejected by the new rule).

- [ ] **Step 2: Run the test — expect failure**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run src/validator.test.ts
  ```
  Expected: FAIL — the new test fails because the validator does not yet reject `deepbook + supply`.

- [ ] **Step 3: Add the guard to `actionflow/src/validator.ts`**

  After the existing `scallop + withdraw` guard (around line 45):
  ```ts
  if (protocol === 'scallop' && action !== 'supply') {
    errors.push({ field: 'action', reason: `scallop ${action} is not supported on-chain yet` })
  }
  ```
  Add immediately after:
  ```ts
  if (protocol === 'deepbook' && action === 'supply') {
    errors.push({
      field: 'action',
      reason: "deepbook does not support 'supply'; use 'swap' or 'place_limit_order'",
    })
  }
  ```

- [ ] **Step 4: Run the validator tests — expect all to pass**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run src/validator.test.ts
  ```
  Expected: all tests pass.

- [ ] **Step 5: Run the full test suite across all packages**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx vitest run
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run
  ```
  Expected: all tests pass in all three packages.

- [ ] **Step 6: Type-check all three packages**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 7: Commit**

  ```
  git add actionflow/src/validator.ts actionflow/src/validator.test.ts
  git commit -m "feat: reject deepbook + supply in validator with explicit error message"
  ```
