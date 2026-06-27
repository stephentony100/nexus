// policyloop/src/index.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyState } from 'actionflow'
import type Anthropic from '@anthropic-ai/sdk'

vi.mock('actionflow', () => ({
  fetchPolicyState: vi.fn(),
  validateAction: vi.fn(),
  buildActionPtb: vi.fn(),
}))

vi.mock('agentrunner', () => ({
  loadAgentKeypair: vi.fn(),
  submitTransaction: vi.fn(),
}))

vi.mock('./decision.js', () => ({
  checkEligibility: vi.fn(),
}))

vi.mock('./aiDecision.js', () => ({
  consultDecisionAI: vi.fn(),
}))

import { fetchPolicyState, validateAction, buildActionPtb } from 'actionflow'
import { submitTransaction } from 'agentrunner'
import { checkEligibility } from './decision.js'
import { consultDecisionAI } from './aiDecision.js'
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
  beforeEach(() => vi.clearAllMocks())

  it('returns skipped without calling AI or validateAction when eligibility check fails', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState({ paused: true }))
    vi.mocked(checkEligibility).mockReturnValue({ eligible: false, reason: 'policy is paused' })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
    })

    expect(result).toEqual({ ok: true, status: 'skipped', reason: 'policy is paused' })
    expect(consultDecisionAI).not.toHaveBeenCalled()
    expect(validateAction).not.toHaveBeenCalled()
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('calls consultDecisionAI and submits when opts.ai is set and AI proposes', async () => {
    const signer = Ed25519Keypair.generate()
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(consultDecisionAI).mockResolvedValue({
      kind: 'propose',
      protocol: 'scallop',
      amount: 75,
      reasoning: 'good yield',
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
        walrusBlobId: 'blob',
        timestampMs: '1700000000000',
      },
    })

    const fakeClient = {} as Anthropic
    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
      ai: { client: fakeClient },
    })

    expect(result.ok).toBe(true)
    expect(consultDecisionAI).toHaveBeenCalledWith(
      expect.objectContaining({ allowedProtocols: ['scallop'] }),
      fakeClient,
      { marketContext: undefined, throwOnAiFailure: undefined },
    )
    expect(validateAction).toHaveBeenCalledWith(
      { protocol: 'scallop', amount: 75, action: 'supply' },
      expect.any(Object),
      expect.any(Number),
      POLICY_ID,
    )
    expect(submitTransaction).toHaveBeenCalledTimes(1)
  })

  it('returns skipped without calling validateAction when opts.ai is set and AI returns skip', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
    vi.mocked(consultDecisionAI).mockResolvedValue({ kind: 'skip', reason: 'no good opportunities' })
    const signer = Ed25519Keypair.generate()

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
      ai: { client: {} as Anthropic },
    })

    expect(result).toEqual({ ok: true, status: 'skipped', reason: 'no good opportunities' })
    expect(validateAction).not.toHaveBeenCalled()
    expect(submitTransaction).not.toHaveBeenCalled()
  })

  it('uses legacy deterministic propose when opts.ai is not set', async () => {
    const signer = Ed25519Keypair.generate()
    const state = basePolicyState({ maxTotalBudget: 1000, spentTotal: 0, maxSingleTx: 100 })
    vi.mocked(fetchPolicyState).mockResolvedValue(state)
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

    const result = await runPolicyCycle({
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'blob',
      signer,
    })

    expect(result.ok).toBe(true)
    expect(consultDecisionAI).not.toHaveBeenCalled()
    expect(validateAction).toHaveBeenCalledWith(
      { protocol: 'scallop', amount: 100, action: 'supply' },
      expect.any(Object),
      expect.any(Number),
      POLICY_ID,
    )
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

  it('returns validation_failed when validateAction rejects the proposed action', async () => {
    vi.mocked(fetchPolicyState).mockResolvedValue(basePolicyState())
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
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
    vi.mocked(checkEligibility).mockReturnValue({ eligible: true })
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

    expect(result).toEqual({
      ok: false,
      status: 'config_missing',
      reason: 'scallop config required for scallop supply',
    })
    expect(submitTransaction).not.toHaveBeenCalled()
  })

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
})
