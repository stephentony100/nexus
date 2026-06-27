# Walrus Integration — Design Spec

**Date:** 2026-06-27
**Scope:** `policyloop` package — `src/walrus.ts` (new), `src/index.ts`, `src/config.ts`, `bin/daemon.ts`, `bin/policyloop.ts`

---

## Problem

Every policy cycle uses a static `walrusBlobId` injected through environment config. The blob ID does not describe the actual action being executed — it is a fixed placeholder that makes every on-chain record identical. Real Walrus storage would upload a per-cycle artifact containing the decision metadata and return the real blob ID before the PTB is built.

---

## Design

### Placement

The upload step belongs in `policyloop/src/index.ts` inside `runPolicyCycle`, after the decision is finalized and before `buildActionPtb`. This keeps:

- `actionflow` as pure PTB-building logic
- `agentrunner` as pure signing/submission logic
- `policyloop` as the orchestrator that prepares execution metadata

### Approach: interface + optional uploader + SDK-backed impl

`runPolicyCycle` accepts an optional `walrus.uploader` in `PolicyLoopOptions`. When present, it uploads a JSON artifact and uses the returned `blobId`. When absent, it falls back to the static `walrusBlobId`. If neither is provided, the cycle returns `config_missing`.

This keeps backward compatibility: existing callers that have not configured `WALRUS_NETWORK` continue to work with the static blob.

---

## New File: `policyloop/src/walrus.ts`

Exports the public interface, the concrete SDK-backed class, and the config type used by `config.ts`.

```ts
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { WalrusClient } from '@mysten/walrus'

export interface WalrusUploader {
  uploadJson(input: {
    data: unknown
    epochs?: number
    deletable?: boolean
  }): Promise<{ blobId: string; blobObjectId?: string }>
}

export interface WalrusClientConfig {
  network: 'testnet' | 'mainnet'
}

export class WalrusUploaderImpl implements WalrusUploader {
  private readonly client: WalrusClient

  constructor(private readonly opts: { config: WalrusClientConfig; signer: Ed25519Keypair }) {
    this.client = new WalrusClient({ network: opts.config.network })
  }

  async uploadJson(input: { data: unknown; epochs?: number; deletable?: boolean }) {
    const blob = new TextEncoder().encode(JSON.stringify(input.data))
    const result = await this.client.writeBlob({
      blob,
      epochs: input.epochs ?? 1,
      deletable: input.deletable ?? false,
      signer: this.opts.signer,
    })
    return { blobId: result.blobId, blobObjectId: result.blobObject?.id }
  }
}
```

`WalrusClient` is constructed once in the constructor — the daemon is long-running, and the client is stateless and reusable across cycles.

---

## Changes to `policyloop/src/index.ts`

### `PolicyLoopOptions`

`walrusBlobId` becomes optional. `walrus` is added:

```ts
export interface PolicyLoopOptions {
  policyId: string
  packageId: string
  walrusBlobId?: string        // required only when walrus.uploader is not configured
  walrus?: {
    uploader: WalrusUploader
    epochs?: number
    deletable?: boolean
  }
  scallop?: ScallopConfig
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
  ai?: { client: Anthropic; marketContext?: string; throwOnAiFailure?: boolean }
}
```

### `PolicyLoopResult`

Add `upload_failed`:

```ts
export type PolicyLoopResult =
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: false; status: 'upload_failed'; reason: string }
  | RunActionResult
```

### Decision capture

In the AI branch, capture `decisionReasoning` from the `propose` result:

```ts
let decision: { protocol: string; amount: number; action: 'supply' }
let decisionReasoning: string | undefined

if (opts.ai) {
  const aiDecision = await consultDecisionAI(state, opts.ai.client, {
    marketContext: opts.ai.marketContext,
    throwOnAiFailure: opts.ai.throwOnAiFailure,
  })
  if (aiDecision.kind === 'skip') {
    return { ok: true, status: 'skipped', reason: aiDecision.reason }
  }
  decision = { protocol: aiDecision.protocol, amount: aiDecision.amount, action: 'supply' }
  decisionReasoning = aiDecision.reasoning
} else {
  decision = {
    protocol: state.allowedProtocols[0],
    amount: Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx),
    action: 'supply',
  }
}
```

### Upload step

Inserted after validation passes, before `buildActionPtb`:

```ts
let walrusBlobId: string
if (opts.walrus) {
  const artifact = {
    policyId: opts.policyId,
    protocol: decision.protocol,
    action: decision.action,
    amount: decision.amount,
    decisionSource: opts.ai ? 'ai' : 'legacy',
    marketContextPresent: Boolean(opts.ai?.marketContext),
    ...(decisionReasoning !== undefined ? { decisionReasoning } : {}),
    createdAt: new Date().toISOString(),
  }
  try {
    const result = await opts.walrus.uploader.uploadJson({
      data: artifact,
      epochs: opts.walrus.epochs,
      deletable: opts.walrus.deletable,
    })
    walrusBlobId = result.blobId
  } catch (err) {
    return {
      ok: false,
      status: 'upload_failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
} else {
  if (!opts.walrusBlobId) {
    return {
      ok: false,
      status: 'config_missing',
      reason: 'walrusBlobId required when walrus uploader is not configured',
    }
  }
  walrusBlobId = opts.walrusBlobId
}
```

The existing `buildActionPtb` call receives the resolved `walrusBlobId`:

```ts
const built = buildActionPtb(validated.action, walrusBlobId, opts.packageId, opts.scallop)
```

---

## Changes to `policyloop/src/config.ts`

Add `readWalrusConfig()`:

```ts
import type { WalrusClientConfig } from './walrus.js'

export function readWalrusConfig(): WalrusClientConfig | undefined {
  const network = process.env.WALRUS_NETWORK
  if (!network) return undefined
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`WALRUS_NETWORK must be 'testnet' or 'mainnet' (got: ${network})`)
  }
  return { network }
}
```

---

## Changes to `policyloop/bin/daemon.ts` and `policyloop/bin/policyloop.ts`

Both bins get the same wiring pattern. The agent keypair is loaded once and reused for both the Walrus signer and `PolicyLoopOptions.signer`:

```ts
import { readScallopConfig, readAiConfig, readWalrusConfig } from '../src/config.js'
import { WalrusUploaderImpl } from '../src/walrus.js'
import { loadAgentKeypair } from 'agentrunner'
import type { PolicyLoopOptions } from '../src/index.js'

// ... env validation ...

const walrusConfig = readWalrusConfig()  // throws on invalid WALRUS_NETWORK value
const signer = loadAgentKeypair()        // replaces the previous requireEnv('AGENTRUNNER_PRIVATE_KEY') validation-only call

let walrus: PolicyLoopOptions['walrus']
let walrusBlobId: string | undefined

if (walrusConfig) {
  walrus = { uploader: new WalrusUploaderImpl({ config: walrusConfig, signer }) }
} else {
  walrusBlobId = requireEnv('ACTIONFLOW_WALRUS_BLOB_ID')
}

const policyOpts: PolicyLoopOptions = {
  policyId,
  packageId,
  walrusBlobId,
  walrus,
  signer,
  scallop: readScallopConfig(),
  ai: readAiConfig(),
}
```

`ACTIONFLOW_WALRUS_BLOB_ID` is required only when `WALRUS_NETWORK` is absent. No existing deployment breaks.

### `policyloop.ts` result switch additions

Add both missing cases:

```ts
case 'unsupported_action':
  console.error(`Action not supported: ${result.reason}`)
  process.exit(1)
  return
case 'upload_failed':
  console.error(`Walrus upload failed: ${result.reason}`)
  process.exit(1)
  return
```

`unsupported_action` was missing from the switch after the DeepBook safety fix; both are added together here.

---

## Daemon behavior: `upload_failed`

`upload_failed` is a handled operational result, not an unexpected error. The daemon's existing `cycle_completed` handler logs it at `warn` level and sleeps normally — no backoff. Backoff is reserved for uncaught throws.

---

## Dependency

Add `@mysten/walrus` to `policyloop/package.json`. No changes to `actionflow` or `agentrunner`.

---

## Tests

### `policyloop/src/walrus.test.ts`

- `WalrusClient` is constructed exactly once when `WalrusUploaderImpl` is instantiated (constructor spy)
- `uploadJson` calls `client.writeBlob` with `blob`, `epochs`, `deletable`, and `signer`
- Default values: `epochs` defaults to `1`, `deletable` defaults to `false` when not provided
- Custom values: `epochs: 5, deletable: true` propagate correctly to `writeBlob`
- Returns `{ blobId, blobObjectId }` from the SDK result
- `blobObjectId` is `undefined` when `result.blobObject` is absent
- `network: 'testnet'` and `network: 'mainnet'` both pass through to `WalrusClient`

### `policyloop/src/index.test.ts` (new cases)

- When `opts.walrus.uploader` is present: `uploadJson` is called with the expected artifact fields (`policyId`, `protocol`, `action`, `amount`, `decisionSource`, `marketContextPresent`, `createdAt`); returned `blobId` is passed to `buildActionPtb`
- `decisionReasoning` is present in the artifact on AI `propose` decisions; absent on legacy decisions
- Custom `opts.walrus.epochs` and `opts.walrus.deletable` are forwarded to `uploadJson`
- When `uploadJson` throws: cycle returns `{ ok: false, status: 'upload_failed', reason: '...' }` without calling `buildActionPtb`
- When `opts.walrus` is absent and `opts.walrusBlobId` is set: static blob ID passes to `buildActionPtb` unchanged
- When neither `opts.walrus` nor `opts.walrusBlobId` is provided: cycle returns `{ ok: false, status: 'config_missing', reason: '...' }`

### `policyloop/src/config.test.ts` (new cases)

- `readWalrusConfig()` returns `undefined` when `WALRUS_NETWORK` is unset
- Returns `{ network: 'testnet' }` when `WALRUS_NETWORK=testnet`
- Returns `{ network: 'mainnet' }` when `WALRUS_NETWORK=mainnet`
- Throws when `WALRUS_NETWORK` is set to an invalid value (e.g. `'local'`)

---

## What is NOT in scope

- Separate `WALRUS_PRIVATE_KEY` env var — future option if fund/permission separation is needed
- Explicit `publisherUrl`/`aggregatorUrl` override — internal `WalrusClientConfig` shape supports it but Phase 2 does not expose or test it
- Walrus read/retrieval — Phase 2 is write-only
- Any changes to `actionflow` or `agentrunner`
- Any changes to `aiDecision.ts`
