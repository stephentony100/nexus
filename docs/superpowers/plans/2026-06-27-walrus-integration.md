# Walrus Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static `walrusBlobId` placeholder with real per-cycle Walrus uploads in `policyloop`, while keeping the static path as a backward-compatible fallback.

**Architecture:** A new `WalrusUploader` interface (injectable in tests) is added to `policyloop/src/walrus.ts`, backed by a `WalrusUploaderImpl` that wraps `@mysten/walrus`. `runPolicyCycle` gains an optional `walrus` option: when present, it uploads a JSON decision artifact after validation and uses the returned `blobId`; when absent, it falls back to the static `walrusBlobId`. Both `bin/daemon.ts` and `bin/policyloop.ts` wire up the concrete uploader when `WALRUS_NETWORK` is set in the environment.

**Tech Stack:** `@mysten/walrus` SDK, `@mysten/sui` keypairs, TypeScript ESM, vitest

## Global Constraints

- Working package: `policyloop` at `C:/Users/NT/Desktop/nexus/policyloop`
- All local TypeScript imports use `.js` extension (ESM), e.g. `import { WalrusUploaderImpl } from './walrus.js'`
- No changes to `actionflow` or `agentrunner` packages
- TypeScript 6 strict mode — `npx tsc --noEmit` must pass with zero errors in all three packages
- vitest 4.1.9 — run tests with `npx vitest run` from inside each package directory
- TDD: write the failing test first, verify it fails, then implement
- Frequent small commits

---

### Task 1: `walrus.ts` — `WalrusUploader` interface, `WalrusUploaderImpl`, `@mysten/walrus` dependency

**Files:**
- Modify: `policyloop/package.json`
- Create: `policyloop/src/walrus.ts`
- Create: `policyloop/src/walrus.test.ts`

**Interfaces:**
- Consumes: `Ed25519Keypair` from `@mysten/sui/keypairs/ed25519`; `WalrusClient` from `@mysten/walrus`
- Produces (used by Tasks 2, 3, 4):
  ```ts
  export interface WalrusUploader {
    uploadJson(input: { data: unknown; epochs?: number; deletable?: boolean }): Promise<{ blobId: string; blobObjectId?: string }>
  }
  export interface WalrusClientConfig {
    network: 'testnet' | 'mainnet'
  }
  export class WalrusUploaderImpl implements WalrusUploader { ... }
  ```

- [ ] **Step 1: Install `@mysten/walrus`**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npm install @mysten/walrus
  ```

  After install, check the actual SDK types to verify three things before writing code:

  ```
  cat node_modules/@mysten/walrus/dist/index.d.ts | head -80
  ```

  Verify:
  1. Import path: is it `import { WalrusClient } from '@mysten/walrus'`?
  2. Constructor: does it accept `{ network: 'testnet' | 'mainnet' }`?
  3. `writeBlob` return shape: is the blob ID at `result.blobId`? Is the object ID at `result.blobObject?.id` or `result.blobObject?.objectId`?

  **The plan uses the expected shape. If the actual SDK differs, adapt every occurrence of `result.blobObject?.id` to the real field name.**

- [ ] **Step 2: Write `policyloop/src/walrus.test.ts`**

  ```ts
  import { beforeEach, describe, expect, it, vi } from 'vitest'
  import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

  const mockWriteBlob = vi.fn()
  const MockWalrusClient = vi.fn().mockImplementation(() => ({ writeBlob: mockWriteBlob }))
  vi.mock('@mysten/walrus', () => ({ WalrusClient: MockWalrusClient }))

  import { WalrusUploaderImpl } from './walrus.js'
  import { WalrusClient } from '@mysten/walrus'

  const SIGNER = Ed25519Keypair.generate()

  describe('WalrusUploaderImpl', () => {
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('constructs WalrusClient once with network from config (testnet)', () => {
      new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
      expect(WalrusClient).toHaveBeenCalledTimes(1)
      expect(WalrusClient).toHaveBeenCalledWith({ network: 'testnet' })
    })

    it('constructs WalrusClient with mainnet when config specifies mainnet', () => {
      new WalrusUploaderImpl({ config: { network: 'mainnet' }, signer: SIGNER })
      expect(WalrusClient).toHaveBeenCalledWith({ network: 'mainnet' })
    })

    it('does not construct a second WalrusClient on uploadJson call', async () => {
      const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
      mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: undefined })
      await uploader.uploadJson({ data: { foo: 'bar' } })
      expect(WalrusClient).toHaveBeenCalledTimes(1)
    })

    it('calls writeBlob with JSON-encoded data, default epochs=1, default deletable=false, and signer', async () => {
      const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
      mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: undefined })

      await uploader.uploadJson({ data: { amount: 100 } })

      expect(mockWriteBlob).toHaveBeenCalledWith({
        blob: new TextEncoder().encode(JSON.stringify({ amount: 100 })),
        epochs: 1,
        deletable: false,
        signer: SIGNER,
      })
    })

    it('propagates custom epochs and deletable to writeBlob', async () => {
      const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
      mockWriteBlob.mockResolvedValue({ blobId: 'xyz', blobObject: undefined })

      await uploader.uploadJson({ data: {}, epochs: 5, deletable: true })

      expect(mockWriteBlob).toHaveBeenCalledWith(
        expect.objectContaining({ epochs: 5, deletable: true }),
      )
    })

    it('returns blobId and blobObjectId from writeBlob result', async () => {
      const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
      mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: { id: 'obj-1' } })

      const result = await uploader.uploadJson({ data: {} })

      expect(result).toEqual({ blobId: 'abc123', blobObjectId: 'obj-1' })
    })

    it('returns blobObjectId as undefined when blobObject is absent', async () => {
      const uploader = new WalrusUploaderImpl({ config: { network: 'testnet' }, signer: SIGNER })
      mockWriteBlob.mockResolvedValue({ blobId: 'abc123', blobObject: undefined })

      const result = await uploader.uploadJson({ data: {} })

      expect(result).toEqual({ blobId: 'abc123', blobObjectId: undefined })
    })
  })
  ```

  **If Step 1 revealed that `blobObject.id` is actually `blobObject.objectId` or another field, update the mock return value and assertion in the `blobObjectId` tests to match.**

- [ ] **Step 3: Run the tests — expect failure**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/walrus.test.ts
  ```
  Expected: FAIL — `walrus.ts` does not exist yet.

- [ ] **Step 4: Write `policyloop/src/walrus.ts`**

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
      // Adapt blobObject field access to match actual SDK return shape verified in Step 1
      return { blobId: result.blobId, blobObjectId: result.blobObject?.id }
    }
  }
  ```

  **Adapt as needed** to match the actual SDK types verified in Step 1 (`writeBlob` argument names, return field names).

- [ ] **Step 5: Run the tests — expect all to pass**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/walrus.test.ts
  ```
  Expected: 7 tests pass.

- [ ] **Step 6: Type-check**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 7: Commit**

  ```
  git add policyloop/package.json policyloop/package-lock.json policyloop/src/walrus.ts policyloop/src/walrus.test.ts
  git commit -m "feat(policyloop): add WalrusUploader interface and WalrusUploaderImpl"
  ```

---

### Task 2: `config.ts` — `readWalrusConfig()`

**Files:**
- Modify: `policyloop/src/config.ts`
- Modify: `policyloop/src/config.test.ts`

**Interfaces:**
- Consumes (from Task 1): `WalrusClientConfig` from `./walrus.js`
- Produces (used by Task 4):
  ```ts
  export function readWalrusConfig(): WalrusClientConfig | undefined
  // Returns { network: 'testnet' } or { network: 'mainnet' }
  // Returns undefined when WALRUS_NETWORK is unset
  // Throws when WALRUS_NETWORK is set to an invalid value
  ```

- [ ] **Step 1: Add failing tests to `policyloop/src/config.test.ts`**

  Update the import at the top of the file:
  ```ts
  import { afterEach, describe, expect, it, vi } from 'vitest'
  import { readDaemonConfig, readWalrusConfig } from './config.js'
  ```

  Append a new `describe` block after the existing `readDaemonConfig` block:
  ```ts
  describe('readWalrusConfig', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('returns undefined when WALRUS_NETWORK is not set', () => {
      expect(readWalrusConfig()).toBeUndefined()
    })

    it('returns { network: "testnet" } when WALRUS_NETWORK=testnet', () => {
      vi.stubEnv('WALRUS_NETWORK', 'testnet')
      expect(readWalrusConfig()).toEqual({ network: 'testnet' })
    })

    it('returns { network: "mainnet" } when WALRUS_NETWORK=mainnet', () => {
      vi.stubEnv('WALRUS_NETWORK', 'mainnet')
      expect(readWalrusConfig()).toEqual({ network: 'mainnet' })
    })

    it('throws when WALRUS_NETWORK is an invalid value', () => {
      vi.stubEnv('WALRUS_NETWORK', 'local')
      expect(() => readWalrusConfig()).toThrow("WALRUS_NETWORK must be 'testnet' or 'mainnet'")
    })
  })
  ```

- [ ] **Step 2: Run the tests — expect failure**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/config.test.ts
  ```
  Expected: FAIL — `readWalrusConfig` is not exported from `config.ts`.

- [ ] **Step 3: Add `readWalrusConfig` to `policyloop/src/config.ts`**

  Add this import at the top of the file (after the existing imports):
  ```ts
  import type { WalrusClientConfig } from './walrus.js'
  ```

  Append after the existing `readDaemonConfig` function:
  ```ts
  export function readWalrusConfig(): WalrusClientConfig | undefined {
    const network = process.env.WALRUS_NETWORK
    if (!network) return undefined
    if (network !== 'testnet' && network !== 'mainnet') {
      throw new Error(`WALRUS_NETWORK must be 'testnet' or 'mainnet' (got: ${network})`)
    }
    return { network }
  }
  ```

- [ ] **Step 4: Run the tests — expect all to pass**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/config.test.ts
  ```
  Expected: all tests pass (existing + 4 new).

- [ ] **Step 5: Type-check**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 6: Commit**

  ```
  git add policyloop/src/config.ts policyloop/src/config.test.ts
  git commit -m "feat(policyloop): add readWalrusConfig to config.ts"
  ```

---

### Task 3: `index.ts` — upload step, `PolicyLoopOptions` extension, new tests

**Files:**
- Modify: `policyloop/src/index.ts`
- Modify: `policyloop/src/index.test.ts`

**Interfaces:**
- Consumes (from Task 1): `WalrusUploader` from `./walrus.js` (type import only — no runtime import, the uploader is injected)
- Produces:
  ```ts
  export interface PolicyLoopOptions {
    policyId: string
    packageId: string
    walrusBlobId?: string           // optional when walrus.uploader is provided
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
  export type PolicyLoopResult =
    | { ok: true; status: 'skipped'; reason: string }
    | { ok: false; status: 'upload_failed'; reason: string }
    | RunActionResult
  ```

- [ ] **Step 1: Add failing tests to `policyloop/src/index.test.ts`**

  No new mocks are needed — `index.ts` uses `WalrusUploader` only as an injected interface, so there is no module to mock. Add the following tests inside the existing `describe('runPolicyCycle', () => {` block:

  ```ts
  it('returns config_missing when neither walrus.uploader nor walrusBlobId is provided', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(validateAction).mockReturnValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' },
    })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      // neither walrusBlobId nor walrus provided
      signer,
    })

    expect(result).toEqual({
      ok: false,
      status: 'config_missing',
      reason: 'walrusBlobId required when walrus uploader is not configured',
    })
    expect(buildActionPtb).not.toHaveBeenCalled()
  })

  it('calls uploadJson with correct artifact and passes returned blobId to buildActionPtb', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
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
        walrusBlobId: 'real-blob-id',
        timestampMs: '1700000000000',
      },
    })
    const mockUploader = { uploadJson: vi.fn().mockResolvedValue({ blobId: 'real-blob-id' }) }

    await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      signer,
      walrus: { uploader: mockUploader },
    })

    expect(mockUploader.uploadJson).toHaveBeenCalledTimes(1)
    const uploadArg = mockUploader.uploadJson.mock.calls[0][0]
    expect(uploadArg.data).toMatchObject({
      policyId: POLICY_ID,
      protocol: 'scallop',
      action: 'supply',
      amount: 100,
      decisionSource: 'legacy',
      marketContextPresent: false,
    })
    expect(uploadArg.data).toHaveProperty('createdAt')
    expect(buildActionPtb).toHaveBeenCalledWith(
      expect.any(Object),
      'real-blob-id',
      PACKAGE_ID,
      undefined,
    )
  })

  it('includes decisionReasoning in artifact for AI propose decisions', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(consultDecisionAI).mockResolvedValue({
      kind: 'propose',
      protocol: 'scallop',
      amount: 75,
      reasoning: 'good yield opportunity',
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
        walrusBlobId: 'ai-blob-id',
        timestampMs: '1700000000000',
      },
    })
    const mockUploader = { uploadJson: vi.fn().mockResolvedValue({ blobId: 'ai-blob-id' }) }

    await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      signer,
      ai: { client: {} as Anthropic },
      walrus: { uploader: mockUploader },
    })

    const uploadArg = mockUploader.uploadJson.mock.calls[0][0]
    expect(uploadArg.data).toMatchObject({
      decisionSource: 'ai',
      decisionReasoning: 'good yield opportunity',
    })
  })

  it('artifact omits decisionReasoning for legacy (non-AI) decisions', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
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
        walrusBlobId: 'blob-id',
        timestampMs: '1700000000000',
      },
    })
    const mockUploader = { uploadJson: vi.fn().mockResolvedValue({ blobId: 'blob-id' }) }

    await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      signer,
      walrus: { uploader: mockUploader },
    })

    const uploadArg = mockUploader.uploadJson.mock.calls[0][0]
    expect(uploadArg.data).not.toHaveProperty('decisionReasoning')
    expect(uploadArg.data.decisionSource).toBe('legacy')
  })

  it('forwards opts.walrus.epochs and opts.walrus.deletable to uploadJson', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
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
    const mockUploader = { uploadJson: vi.fn().mockResolvedValue({ blobId: 'blob' }) }

    await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      signer,
      walrus: { uploader: mockUploader, epochs: 5, deletable: true },
    })

    expect(mockUploader.uploadJson).toHaveBeenCalledWith(
      expect.objectContaining({ epochs: 5, deletable: true }),
    )
  })

  it('returns upload_failed and does not call buildActionPtb when uploadJson throws', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(validateAction).mockReturnValue({
      ok: true,
      action: { policyId: POLICY_ID, protocol: 'scallop', amount: 100, action: 'supply' },
    })
    const mockUploader = {
      uploadJson: vi.fn().mockRejectedValue(new Error('network timeout')),
    }

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      signer,
      walrus: { uploader: mockUploader },
    })

    expect(result).toEqual({ ok: false, status: 'upload_failed', reason: 'network timeout' })
    expect(buildActionPtb).not.toHaveBeenCalled()
  })

  it('uses static walrusBlobId and skips upload when walrus uploader is not configured', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
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
        walrusBlobId: 'static-blob',
        timestampMs: '1700000000000',
      },
    })

    await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'static-blob',
      signer,
    })

    expect(buildActionPtb).toHaveBeenCalledWith(
      expect.any(Object),
      'static-blob',
      PACKAGE_ID,
      undefined,
    )
  })
  ```

- [ ] **Step 2: Run the new tests — expect failures**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/index.test.ts
  ```
  Expected: the 7 new tests fail; existing tests still pass.

- [ ] **Step 3: Replace `policyloop/src/index.ts`**

  ```ts
  import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
  import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
  import type Anthropic from '@anthropic-ai/sdk'
  import { fetchPolicyState, validateAction, buildActionPtb } from 'actionflow'
  import type { ScallopConfig } from 'actionflow'
  import { loadAgentKeypair, submitTransaction } from 'agentrunner'
  import type { RunActionResult } from 'agentrunner'
  import { checkEligibility } from './decision.js'
  import { consultDecisionAI } from './aiDecision.js'
  import type { WalrusUploader } from './walrus.js'

  export interface PolicyLoopOptions {
    policyId: string
    packageId: string
    walrusBlobId?: string
    walrus?: {
      uploader: WalrusUploader
      epochs?: number
      deletable?: boolean
    }
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
    | { ok: false; status: 'upload_failed'; reason: string }
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
    let decisionReasoning: string | undefined

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
      decisionReasoning = aiDecision.reasoning
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

    const built = buildActionPtb(validated.action, walrusBlobId, opts.packageId, opts.scallop)
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

- [ ] **Step 4: Run the full index test suite — expect all to pass**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/index.test.ts
  ```
  Expected: all tests pass (existing 8 + new 7 = 15 total).

- [ ] **Step 5: Type-check**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 6: Commit**

  ```
  git add policyloop/src/index.ts policyloop/src/index.test.ts
  git commit -m "feat(policyloop): add Walrus upload step to runPolicyCycle"
  ```

---

### Task 4: Bin wiring — `daemon.ts` and `policyloop.ts`

**Files:**
- Modify: `policyloop/bin/daemon.ts`
- Modify: `policyloop/bin/policyloop.ts`

**Interfaces:**
- Consumes (Task 1): `WalrusUploaderImpl` from `../src/walrus.js`
- Consumes (Task 2): `readWalrusConfig` from `../src/config.js`
- Consumes: `loadAgentKeypair` from `agentrunner`

No new tests — the bins are CLI entry points; their logic flows through `runPolicyCycle`, which is fully tested in Task 3.

- [ ] **Step 1: Replace `policyloop/bin/daemon.ts`**

  ```ts
  #!/usr/bin/env node
  import { readScallopConfig, readAiConfig, readDaemonConfig, readWalrusConfig } from '../src/config.js'
  import { WalrusUploaderImpl } from '../src/walrus.js'
  import { runDaemon } from '../src/daemon.js'
  import type { LogRecord } from '../src/daemon.js'
  import type { PolicyLoopOptions } from '../src/index.js'
  import { loadAgentKeypair } from 'agentrunner'

  function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) {
      console.error(`Missing ${name} environment variable`)
      process.exit(1)
    }
    return value
  }

  async function main() {
    const policyId = requireEnv('ACTIONFLOW_POLICY_ID')
    const packageId = requireEnv('ACTIONFLOW_PACKAGE_ID')

    let config
    try {
      config = readDaemonConfig()
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    let walrusConfig
    try {
      walrusConfig = readWalrusConfig()
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    // loadAgentKeypair reads AGENTRUNNER_PRIVATE_KEY — replaces the previous requireEnv-only validation call
    const signer = loadAgentKeypair()

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

    const controller = new AbortController()
    process.once('SIGINT', () => controller.abort())
    process.once('SIGTERM', () => controller.abort())

    const onLog = (record: LogRecord) => process.stdout.write(JSON.stringify(record) + '\n')

    await runDaemon(policyOpts, config, controller.signal, onLog)
    // Node exits naturally — no process.exit(0)
  }

  main().catch((err) => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
  ```

- [ ] **Step 2: Replace `policyloop/bin/policyloop.ts`**

  ```ts
  #!/usr/bin/env node
  import { readScallopConfig, readAiConfig, readWalrusConfig } from '../src/config.js'
  import { WalrusUploaderImpl } from '../src/walrus.js'
  import { runPolicyCycle } from '../src/index.js'
  import type { PolicyLoopOptions } from '../src/index.js'
  import { loadAgentKeypair } from 'agentrunner'

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

    if (!process.env.AGENTRUNNER_PRIVATE_KEY) {
      console.error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
      process.exit(1)
    }

    let walrusConfig
    try {
      walrusConfig = readWalrusConfig()
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    const signer = loadAgentKeypair()

    let walrus: PolicyLoopOptions['walrus']
    let walrusBlobId: string | undefined

    if (walrusConfig) {
      walrus = { uploader: new WalrusUploaderImpl({ config: walrusConfig, signer }) }
    } else {
      const staticBlobId = process.env.ACTIONFLOW_WALRUS_BLOB_ID
      if (!staticBlobId) {
        console.error(
          'Missing ACTIONFLOW_WALRUS_BLOB_ID environment variable (required when WALRUS_NETWORK is not set)',
        )
        process.exit(1)
      }
      walrusBlobId = staticBlobId
    }

    const result = await runPolicyCycle({
      policyId,
      packageId,
      walrusBlobId,
      walrus,
      signer,
      scallop: readScallopConfig(),
      ai: readAiConfig(),
    })

    switch (result.status) {
      case 'skipped':
        console.log(`Skipped: ${result.reason}`)
        return
      case 'succeeded':
        console.log(
          result.eventKind === 'scallop_sui_supplied'
            ? 'Scallop SUI supply recorded on-chain:'
            : 'Action recorded on-chain:',
        )
        console.log(JSON.stringify(result.event, null, 2))
        console.log(`\nDigest: ${result.digest}`)
        return
      case 'upload_failed':
        console.error(`Walrus upload failed: ${result.reason}`)
        process.exit(1)
        return
      case 'unsupported_action':
        console.error(`Action not supported: ${result.reason}`)
        process.exit(1)
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
        console.error(
          `Execution reported success (digest ${result.digest}) but no recognized event was found`,
        )
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

- [ ] **Step 3: Type-check all three packages**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/actionflow && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx tsc --noEmit
  ```
  Expected: zero errors in all three.

- [ ] **Step 4: Run the full policyloop test suite**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run
  ```
  Expected: all tests pass.

- [ ] **Step 5: Commit**

  ```
  git add policyloop/bin/daemon.ts policyloop/bin/policyloop.ts
  git commit -m "feat(policyloop): wire WalrusUploaderImpl into daemon and CLI bins"
  ```

---

### Task 5: Final verification

**Files:** no changes

- [ ] **Step 1: Run all three package test suites**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx vitest run
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run
  ```
  Expected: all tests pass.
  Minimum expected counts: actionflow 84, agentrunner 27, policyloop 94 (76 existing + 18 new: 7 walrus + 7 index + 4 config).

- [ ] **Step 2: Type-check all three packages**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors.
