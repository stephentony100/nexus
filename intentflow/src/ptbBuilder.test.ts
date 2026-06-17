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
    const moveCalls = data.commands.filter(
      (c): c is { $kind: 'MoveCall'; MoveCall: { package: string; module: string; function: string; arguments: unknown[] } } =>
        c.$kind === 'MoveCall',
    )

    expect(moveCalls).toHaveLength(1)
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('create_policy')
    expect(call.arguments).toHaveLength(6)
  })

  it('builds to bytes without requiring a network client', async () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
