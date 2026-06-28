import { describe, expect, it, vi } from 'vitest'
import type { Transaction } from '@mysten/sui/transactions'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { TransactionSigner } from './signer.js'
import { submitTransaction } from './submitter.js'

const BYTES = new Uint8Array([1, 2, 3])
const SIGNER = {} as TransactionSigner
const ACTION_RECORDED_TYPE = '0x' + '11'.repeat(32) + '::policy::ActionRecorded'
const SCALLOP_SUI_SUPPLIED_TYPE = '0x' + '11'.repeat(32) + '::policy::ScallopSuiSupplied'

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

function scallopSuiSuppliedEvent() {
  return {
    type: SCALLOP_SUI_SUPPLIED_TYPE,
    parsedJson: {
      policy_id: '0xpolicy',
      agent: '0xagent',
      amount: '75',
      spent_total: '175',
      vault_balance: '425',
      scallop_position_balance: '75',
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
      expect(result.eventKind).toBe('action_recorded')
      expect(result.digest).toBe('digest1')
      if (result.eventKind === 'action_recorded') {
        expect(result.event.amount).toBe('50')
        expect(result.event.protocolId).toBe('scallop')
        expect(result.event.walrusBlobId).toBe('blob-id')
      }
    }
  })

  it('returns succeeded with a parsed ScallopSuiSupplied event when that event is emitted instead', async () => {
    const dryRunTransactionBlock = vi.fn().mockResolvedValue(successDryRun())
    const signAndExecuteTransaction = vi.fn().mockResolvedValue({
      digest: 'digest5',
      effects: { status: { status: 'success' } },
      events: [scallopSuiSuppliedEvent()],
    })

    const result = await submitTransaction(mockTx(), SIGNER, mockClient(dryRunTransactionBlock, signAndExecuteTransaction))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.eventKind).toBe('scallop_sui_supplied')
      expect(result.digest).toBe('digest5')
      if (result.eventKind === 'scallop_sui_supplied') {
        expect(result.event.amount).toBe('75')
        expect(result.event.vaultBalance).toBe('425')
        expect(result.event.scallopPositionBalance).toBe('75')
        expect(result.event.walrusBlobId).toBe('blob-id')
      }
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
