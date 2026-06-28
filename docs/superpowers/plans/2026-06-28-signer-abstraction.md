# Phase 6 — Signer Abstraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every `Ed25519Keypair` signer reference in the execution pipeline with a `TransactionSigner` interface. Ship `LocalKeypairSigner` as the concrete implementation. Keep `WalrusUploaderImpl` and `loadAgentKeypair()` unchanged.

**Spec:** `docs/superpowers/specs/2026-06-28-signer-abstraction.md`

**Tech Stack:** TypeScript ESM, vitest 4.1.9, packages: `agentrunner`, `policyloop`

## Global Constraints

- Working packages: `agentrunner` at `C:/Users/NT/Desktop/nexus/agentrunner`, `policyloop` at `C:/Users/NT/Desktop/nexus/policyloop`
- All local TypeScript imports use `.js` extension (ESM)
- `actionflow` package is NOT touched
- TypeScript strict mode — `npx tsc --noEmit` must pass in all three packages (actionflow, agentrunner, policyloop) after each task
- vitest 4.1.9 — run tests with `npx vitest run` from inside each package directory
- TDD: write new tests first, then implement
- `loadAgentKeypair()` return type (`Ed25519Keypair`) must NOT change
- `WalrusUploaderImpl` must NOT be modified

---

### Task 1: `TransactionSigner` interface + agentrunner-internal wiring

**Files:**
- Modify: `agentrunner/src/signer.ts`
- Modify: `agentrunner/src/signer.test.ts`
- Modify: `agentrunner/src/submitter.ts`
- Modify: `agentrunner/src/submitter.test.ts`
- Modify: `agentrunner/src/types.ts`
- Modify: `agentrunner/src/index.ts`

**What to do:**

- [ ] **`agentrunner/src/signer.ts`** — add after the existing `loadAgentKeypair` function:
  ```ts
  export interface TransactionSigner {
    toSuiAddress(): string
    signTransaction(bytes: Uint8Array): Promise<{ signature: string; bytes: string }>
  }

  export class LocalKeypairSigner implements TransactionSigner {
    constructor(private readonly keypair: Ed25519Keypair) {}

    toSuiAddress(): string {
      return this.keypair.toSuiAddress()
    }

    signTransaction(bytes: Uint8Array): Promise<{ signature: string; bytes: string }> {
      return this.keypair.signTransaction(bytes)
    }
  }

  export function createLocalSigner(): LocalKeypairSigner {
    return new LocalKeypairSigner(loadAgentKeypair())
  }
  ```

- [ ] **`agentrunner/src/signer.test.ts`** — write new tests FIRST, verify they fail, then the implementation above makes them pass. Add two new `describe` blocks after the existing `loadAgentKeypair` block:

  `describe('LocalKeypairSigner')`:
  - `toSuiAddress()` returns same address as `keypair.toSuiAddress()`
  - `signTransaction()` resolves to `{ signature: string, bytes: string }`

  `describe('createLocalSigner')`:
  - Returns a `LocalKeypairSigner` with the correct address when `AGENTRUNNER_PRIVATE_KEY` is set
  - Throws matching `/AGENTRUNNER_PRIVATE_KEY/` when env var is unset

  Reuse the existing `afterEach` env cleanup for the `createLocalSigner` tests.

- [ ] **`agentrunner/src/submitter.ts`** — change `signer` parameter:
  - Remove `import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'`
  - Add `import type { TransactionSigner } from './signer.js'`
  - Change `signer: Ed25519Keypair` → `signer: TransactionSigner` in `submitTransaction` signature

- [ ] **`agentrunner/src/submitter.test.ts`** — update mock signer type:
  - Add `import type { TransactionSigner } from './signer.js'`
  - Change `const SIGNER = {} as Ed25519Keypair` → `const SIGNER = {} as TransactionSigner`
  - Remove `import type { Ed25519Keypair }` if it becomes unused

- [ ] **`agentrunner/src/types.ts`** — update `RunActionOptions`:
  - Add `import type { TransactionSigner } from './signer.js'`
  - Remove `import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'`
  - Change `signer?: Ed25519Keypair` → `signer?: TransactionSigner`

- [ ] **`agentrunner/src/index.ts`** — update imports, fallback, and exports:
  - Import `createLocalSigner` from `./signer.js`
  - Change `const signer = opts.signer ?? loadAgentKeypair()` → `const signer = opts.signer ?? createLocalSigner()`
  - Add to exports: `export { ..., LocalKeypairSigner, createLocalSigner } from './signer.js'`
  - Add to type exports: `export type { TransactionSigner } from './signer.js'`

**Verification:**
- `npx vitest run` from `agentrunner/` — all tests pass (existing + new)
- `npx tsc --noEmit` from `agentrunner/` — clean
- Test count must increase (new signer tests added)

---

### Task 2: Plumb `TransactionSigner` through policyloop

**Files:**
- Modify: `policyloop/src/index.ts`
- Modify: `policyloop/src/index.test.ts`
- Modify: `policyloop/bin/daemon.ts`

**Interfaces:**
- Consumes from Task 1: `TransactionSigner`, `LocalKeypairSigner`, `createLocalSigner` (all now exported from `agentrunner`)

**What to do:**

- [ ] **`policyloop/src/index.ts`** — update `PolicyLoopOptions` and imports:
  - Remove `import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'`
  - Change the import from `agentrunner`:
    ```ts
    // before
    import { loadAgentKeypair, submitTransaction } from 'agentrunner'
    // after
    import { createLocalSigner, submitTransaction } from 'agentrunner'
    import type { TransactionSigner } from 'agentrunner'
    ```
  - In `PolicyLoopOptions`: change `signer?: Ed25519Keypair` → `signer?: TransactionSigner`
  - In `runPolicyCycle`: change `const signer = opts.signer ?? loadAgentKeypair()` → `const signer = opts.signer ?? createLocalSigner()`

- [ ] **`policyloop/src/index.test.ts`** — update agentrunner mock:
  - Add `createLocalSigner: vi.fn()` to the `vi.mock('agentrunner', ...)` factory
  - Remove `loadAgentKeypair: vi.fn()` from the mock (no longer imported by `index.ts`)

  No other test changes needed. `Ed25519Keypair.generate()` is structurally compatible with `TransactionSigner` and existing tests still pass.

- [ ] **`policyloop/bin/daemon.ts`** — separate keypair from signer:
  - Add `LocalKeypairSigner` to the `agentrunner` import
  - Keep `loadAgentKeypair` import (still needed for `WalrusUploaderImpl`)
  - After `loadAgentKeypair()` call, wrap the result:
    ```ts
    // before
    const signer = loadAgentKeypair()

    // after
    const keypair = loadAgentKeypair()
    const signer = new LocalKeypairSigner(keypair)
    ```
  - In multi-policy mode: `WalrusUploaderImpl({ config: walrusConfig, signer: keypair })` — pass `keypair`, not `signer`
  - In single-policy mode: same — `WalrusUploaderImpl({ config: walrusConfig, signer: keypair })`
  - `PolicyLoopOptions` in both modes: pass `signer` (the `LocalKeypairSigner`)

**Verification:**
- `npx vitest run` from `policyloop/` — all 101 tests pass
- `npx tsc --noEmit` from `policyloop/` — clean
- `npx tsc --noEmit` from `actionflow/` — clean (no changes, just a sanity check)
- `npx tsc --noEmit` from `agentrunner/` — still clean

---

### Task 3: Final verification

**No file changes.** Read-only verification pass.

- [ ] Run `npx vitest run` from `agentrunner/` — confirm test count increased vs. pre-Phase-6 (28 → higher)
- [ ] Run `npx vitest run` from `actionflow/` — 86 tests, no regressions
- [ ] Run `npx vitest run` from `policyloop/` — 101 tests, no regressions
- [ ] Run `npx tsc --noEmit` from all three packages — all clean
- [ ] Confirm `AGENTRUNNER_PRIVATE_KEY` is still the only required env var for signing (no new env vars introduced)

Report totals. If any test fails, report the failure — do not fix it.
