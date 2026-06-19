import { describe, expect, it } from 'vitest'
import { buildCreatePolicyPtb } from './ptbBuilder.js'
import type { PolicyStrategy } from './types.js'

const STRATEGY: PolicyStrategy = {
  agentAddress: '0x' + 'ab'.repeat(32),
  maxTotalBudget: 500,
  maxSingleTx: 100,
  allowedProtocols: ['scallop', 'deepbook'],
  expiresInDays: 30,
  expiresAtMs: 1_702_592_000_000,
}

const PACKAGE_ID = '0x' + '11'.repeat(32)

describe('buildCreatePolicyPtb', () => {
  it('adds exactly one moveCall targeting policy::create_policy', () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const data = tx.getData()
    const moveCalls = data.commands.filter((command) => command.$kind === 'MoveCall')

    expect(moveCalls).toHaveLength(1)
    const command = moveCalls[0]
    if (!command || command.$kind !== 'MoveCall') {
      throw new Error('Expected create_policy MoveCall command')
    }

    const call = command.MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('create_policy')
    expect(call.arguments).toHaveLength(7)
  })

  it('splits the initial deposit from the gas coin', () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const data = tx.getData()
    const splitCoins = data.commands.filter((command) => command.$kind === 'SplitCoins')

    expect(splitCoins).toHaveLength(1)
    const command = splitCoins[0]
    if (!command || command.$kind !== 'SplitCoins') {
      throw new Error('Expected initial deposit SplitCoins command')
    }

    expect(command.SplitCoins.coin).toEqual({ $kind: 'GasCoin', GasCoin: true })
  })

  it('builds to bytes without requiring a network client', async () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
