import { describe, expect, it, vi } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Transaction } from '@mysten/sui/transactions'
import type { PolicyState } from 'actionflow'

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
})
