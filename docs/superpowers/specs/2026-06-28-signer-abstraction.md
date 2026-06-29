# Phase 6 — Signer Abstraction Design Spec

**Date:** 2026-06-28
**Scope:** `agentrunner` (primary), `policyloop/src/index.ts`, `policyloop/bin/daemon.ts`

---

## Problem

The agent currently signs every Sui transaction with a raw `Ed25519Keypair` loaded from `AGENTRUNNER_PRIVATE_KEY`. This is:

- **A production risk:** a plain-text private key in an environment variable is the weakest possible secret management.
- **A type leak:** `Ed25519Keypair` (a concrete SDK type) flows through three packages (`agentrunner`, `policyloop`, daemon bin). Swapping in a KMS-backed signer would require changing signatures across all three.
- **A consistency gap:** Phase 5 introduced per-policy orchestration; the signer is now conceptually "shared infrastructure" that should be mockable and swappable without touching policy logic.

---

## Goal

Draw a clean signer boundary. The execution pipeline sees `TransactionSigner` everywhere a key is needed for Sui transactions. The concrete `LocalKeypairSigner` (backed by `Ed25519Keypair`) is Phase 6's only implementation. Future phases can add `AwsKmsSigner`, `VaultSigner`, etc. by implementing the same interface.

---

## What is NOT in scope

- zkLogin (Phase 8 dependency — requires browser session flow)
- Per-policy signer identities (layer on after interface stabilises)
- `WalrusUploaderImpl` signer — it signs Walrus blob uploads via the Walrus SDK directly; it's a different concern and stays `Ed25519Keypair` for now
- Any remote signer implementation or `SIGNER_BACKEND` env var

---

## `TransactionSigner` interface

Defined in `agentrunner/src/signer.ts`:

```ts
export interface TransactionSigner {
  toSuiAddress(): string
  signTransaction(bytes: Uint8Array): Promise<{ signature: string; bytes: string }>
}
```

Shape matches the Sui SDK's `Signer` contract (`toSuiAddress` + `signTransaction`). Note: the SDK's `Signer` is an abstract class (not a minimal interface), so structural typing is insufficient — `submitter.ts` uses `signer as unknown as Signer` at the single `signAndExecuteTransaction` call site. The cast is safe because `LocalKeypairSigner` wraps a real `Ed25519Keypair` which is a full `Signer`, and the SDK only calls `signTransaction()` internally.

---

## `LocalKeypairSigner`

```ts
export class LocalKeypairSigner implements TransactionSigner {
  constructor(private readonly keypair: Ed25519Keypair) {}

  toSuiAddress(): string {
    return this.keypair.toSuiAddress()
  }

  signTransaction(bytes: Uint8Array): Promise<{ signature: string; bytes: string }> {
    return this.keypair.signTransaction(bytes)
  }
}
```

- Pure delegation — no logic
- The `keypair` field is private; nothing outside `LocalKeypairSigner` needs it

---

## `createLocalSigner`

```ts
export function createLocalSigner(): LocalKeypairSigner {
  return new LocalKeypairSigner(loadAgentKeypair())
}
```

This is the new factory. `loadAgentKeypair()` is kept for the `WalrusUploaderImpl` call in `bin/daemon.ts`, which still needs the raw `Ed25519Keypair`.

---

## Changes by file

### `agentrunner/src/signer.ts`

Add `TransactionSigner` interface, `LocalKeypairSigner` class, `createLocalSigner()` function.
Keep `loadAgentKeypair()` unchanged (returns `Ed25519Keypair`).

Exports: `TransactionSigner`, `LocalKeypairSigner`, `loadAgentKeypair`, `createLocalSigner`

### `agentrunner/src/submitter.ts`

Change `signer` parameter type:

```ts
// before
export async function submitTransaction(
  tx: Transaction,
  signer: Ed25519Keypair,
  suiClient: SuiJsonRpcClient,
)

// after
export async function submitTransaction(
  tx: Transaction,
  signer: TransactionSigner,
  suiClient: SuiJsonRpcClient,
)
```

Remove the `Ed25519Keypair` import. Import `TransactionSigner` from `./signer.js`.

The `signAndExecuteTransaction` call is unchanged — structural typing makes `TransactionSigner` compatible with the SDK's `Signer` type.

### `agentrunner/src/types.ts`

```ts
// before
signer?: Ed25519Keypair

// after
signer?: TransactionSigner
```

Remove `Ed25519Keypair` import. Import `TransactionSigner` from `./signer.js`.

### `agentrunner/src/index.ts`

```ts
// before
const signer = opts.signer ?? loadAgentKeypair()

// after
const signer = opts.signer ?? createLocalSigner()
```

Export `TransactionSigner`, `LocalKeypairSigner`, `createLocalSigner` alongside existing exports.

### `policyloop/src/index.ts`

```ts
// PolicyLoopOptions — before
signer?: Ed25519Keypair

// after
signer?: TransactionSigner
```

```ts
// before
import { loadAgentKeypair, submitTransaction } from 'agentrunner'
// ...
const signer = opts.signer ?? loadAgentKeypair()

// after
import { createLocalSigner, submitTransaction } from 'agentrunner'
import type { TransactionSigner } from 'agentrunner'
// ...
const signer = opts.signer ?? createLocalSigner()
```

### `policyloop/bin/daemon.ts`

```ts
// before
import { loadAgentKeypair } from 'agentrunner'
// ...
const signer = loadAgentKeypair()
// signer passed to: WalrusUploaderImpl + PolicyLoopOptions

// after
import { loadAgentKeypair, LocalKeypairSigner } from 'agentrunner'
// ...
const keypair = loadAgentKeypair()                    // Ed25519Keypair — for WalrusUploaderImpl
const signer = new LocalKeypairSigner(keypair)         // TransactionSigner — for PolicyLoopOptions

// WalrusUploaderImpl receives keypair (unchanged type)
const uploader = new WalrusUploaderImpl({ config: walrusConfig, signer: keypair })

// PolicyLoopOptions receives signer (abstract interface)
const policies = policyIds.map((policyId) => ({ policyId, packageId, walrus: { uploader }, signer, scallop, ai }))
```

Single-policy mode similarly uses `keypair` for uploader and `signer` for `policyOpts`.

---

## Tests

### `agentrunner/src/signer.test.ts`

Existing `loadAgentKeypair` tests unchanged.

New `describe('LocalKeypairSigner')` block:
- `toSuiAddress()` returns same address as the underlying keypair
- `signTransaction()` resolves to an object with `{ signature: string, bytes: string }`

New `describe('createLocalSigner')` block:
- Returns a `LocalKeypairSigner` with the expected address when env var is set
- Throws with message matching `/AGENTRUNNER_PRIVATE_KEY/` when env var is unset

### `agentrunner/src/submitter.test.ts`

One line change:
```ts
// before
const SIGNER = {} as Ed25519Keypair

// after
const SIGNER = {} as TransactionSigner
```

Add `import type { TransactionSigner }` from `./signer.js`.

### `agentrunner/src/index.test.ts`

No changes required. `Ed25519Keypair.generate()` is structurally compatible with `TransactionSigner` (both have `toSuiAddress()` and `signTransaction()`), so existing tests compile and pass as-is.

### `policyloop/src/index.test.ts`

The agentrunner mock must be updated to include `createLocalSigner`:

```ts
vi.mock('agentrunner', () => ({
  loadAgentKeypair: vi.fn(),     // kept: used by bin, not index.ts after refactor
  createLocalSigner: vi.fn(),    // new: called when opts.signer is undefined
  submitTransaction: vi.fn(),
}))
```

`createLocalSigner` is never called in existing tests (all pass an explicit `signer`). Adding it to the mock prevents "not a function" errors if any test omits `signer`.

No other test changes needed. All tests pass `signer: Ed25519Keypair.generate()`, which is still structurally compatible with `TransactionSigner`.

---

## Backward compatibility

- `loadAgentKeypair()` signature unchanged — callers that need the raw keypair (e.g. `WalrusUploaderImpl`) continue to work.
- `AGENTRUNNER_PRIVATE_KEY` env var behaviour unchanged.
- The `runAction` / `runPolicyCycle` public APIs gain a more general `signer` type. Any caller passing a concrete `Ed25519Keypair` still compiles (structural compatibility).
- `runDaemon` / `runMultiPolicyDaemon` signatures are unchanged — they receive `PolicyLoopOptions`, which now carries `TransactionSigner`.

---

## What stays the same

- `WalrusUploaderImpl.signer: Ed25519Keypair` — Walrus upload signing is a separate concern
- `AGENTRUNNER_PRIVATE_KEY` env var — still the only required secret in Phase 6
- All test counts — no tests deleted, only additions in `signer.test.ts`
