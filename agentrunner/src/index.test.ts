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
