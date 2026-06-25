import { describe, expect, it } from 'vitest'
import { buildRecordActionPtb } from './ptbBuilder.js'
import type { PolicyAction } from './types.js'

const ACTION: PolicyAction = {
  policyId: '0x' + 'aa'.repeat(32),
  protocol: 'scallop',
  amount: 100,
  action: 'supply',
}

const WALRUS_BLOB_ID = 'placeholder-blob-id'
const PACKAGE_ID = '0x' + '11'.repeat(32)

describe('buildRecordActionPtb', () => {
  it('adds exactly one moveCall targeting policy::record_action', () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
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
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, 1)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('throws when building without a client and without the policy object version', async () => {
    const tx = buildRecordActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID)
    await expect(tx.build({ onlyTransactionKind: true })).rejects.toThrow(/sui client/i)
  })
})
