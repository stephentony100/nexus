import { describe, expect, it } from 'vitest'
import { buildActionPtb, buildRecordActionPtb, buildScallopSupplySuiPtb } from './ptbBuilder.js'
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
  it('routes a scallop supply action to buildScallopSupplySuiPtb', () => {
    const result = buildActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, SCALLOP_CONFIG, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
      if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
      expect(moveCalls[0].MoveCall.function).toBe('supply_sui')
    }
  })

  it('returns config_missing when a scallop supply action has no scallop config', () => {
    const result = buildActionPtb(ACTION, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
    expect(result).toEqual({
      ok: false,
      status: 'config_missing',
      reason: 'scallop config required for scallop supply',
    })
  })

  it('routes a non-scallop protocol to buildRecordActionPtb even without scallop config', () => {
    const action: PolicyAction = { ...ACTION, protocol: 'deepbook' }
    const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
      if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
      expect(moveCalls[0].MoveCall.function).toBe('record_action')
    }
  })

  it('routes a scallop withdraw action to buildRecordActionPtb (the routing function only branches on supply; validateAction is what rejects withdraw earlier)', () => {
    const action: PolicyAction = { ...ACTION, action: 'withdraw' }
    const result = buildActionPtb(action, WALRUS_BLOB_ID, PACKAGE_ID, undefined, 1)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const moveCalls = result.tx.getData().commands.filter((c) => c.$kind === 'MoveCall')
      if (moveCalls[0]?.$kind !== 'MoveCall') throw new Error('expected a MoveCall command')
      expect(moveCalls[0].MoveCall.function).toBe('record_action')
    }
  })
})
