import { describe, expect, it, vi } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { PolicyState } from './types.js'

vi.mock('./extractor.js', () => ({
  extractActionGoal: vi.fn(),
  ExtractionRefusedError: class ExtractionRefusedError extends Error {},
}))

vi.mock('./policyState.js', () => ({
  fetchPolicyState: vi.fn(),
  PolicyFetchError: class PolicyFetchError extends Error {},
}))

import { extractActionGoal } from './extractor.js'
import { fetchPolicyState } from './policyState.js'
import { translateAction } from './index.js'

const POLICY_ID = '0x' + 'aa'.repeat(32)
const PACKAGE_ID = '0x' + '11'.repeat(32)

function validState(overrides: Partial<PolicyState> = {}): PolicyState {
  return {
    agent: '0x' + 'bb'.repeat(32),
    maxTotalBudget: 500,
    spentTotal: 100,
    maxSingleTx: 100,
    allowedProtocols: ['scallop'],
    expiresAtMs: Date.now() + 1_000_000,
    paused: false,
    revoked: false,
    ...overrides,
  }
}

describe('translateAction', () => {
  it('returns action and ptbBytes on a full happy path', async () => {
    vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 50, action: 'supply' })
    vi.mocked(fetchPolicyState).mockResolvedValue(validState())

    // A real SuiJsonRpcClient is used (rather than a bare {} stub) because
    // tx.build({ client }) calls client.core.resolveTransactionPlugin(), which
    // is implemented on the real JSONRpcCoreClient but not present on a plain
    // object stub. We spy on the two network calls the resolver actually makes
    // (getObjects to resolve the shared PolicyObject reference, getMoveFunction
    // to resolve record_action's argument types) so no real network access occurs.
    const suiClient = new SuiJsonRpcClient({ url: 'http://localhost:9999', network: 'testnet' })
    vi.spyOn(suiClient.core, 'getObjects').mockResolvedValue({
      objects: [
        {
          objectId: POLICY_ID,
          version: '1',
          digest: '11'.repeat(32),
          owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
          type: `${PACKAGE_ID}::policy::PolicyObject`,
        },
      ],
    } as never)
    vi.spyOn(suiClient.core, 'getMoveFunction').mockResolvedValue({
      function: {
        packageId: PACKAGE_ID,
        moduleName: 'policy',
        name: 'record_action',
        visibility: 'public',
        isEntry: true,
        typeParameters: [],
        parameters: [
          { reference: 'mutable', body: { $kind: 'datatype', datatype: { typeName: `${PACKAGE_ID}::policy::PolicyObject`, typeParameters: [] } } },
          { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
          { reference: null, body: { $kind: 'u64' } },
          { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
          { reference: 'immutable', body: { $kind: 'datatype', datatype: { typeName: '0x2::clock::Clock', typeParameters: [] } } },
        ],
        returns: [],
      },
    } as never)

    const result = await translateAction('deposit 50 into scallop', {
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'placeholder-blob',
      client: {} as Anthropic,
      suiClient,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action.amount).toBe(50)
      expect(typeof result.ptbBytes).toBe('string')
      expect(result.ptbBytes.length).toBeGreaterThan(0)
    }
  })

  it('returns validation errors without building a PTB when budget is exceeded', async () => {
    vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 450, action: 'supply' })
    vi.mocked(fetchPolicyState).mockResolvedValue(validState({ spentTotal: 100, maxTotalBudget: 500, maxSingleTx: 500 }))

    const result = await translateAction('deposit 450 into scallop', {
      policyId: POLICY_ID,
      packageId: PACKAGE_ID,
      walrusBlobId: 'placeholder-blob',
      client: {} as Anthropic,
      suiClient: {} as SuiJsonRpcClient,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContainEqual({
        field: 'amount',
        reason: 'spentTotal (100) + amount (450) exceeds maxTotalBudget (500)',
      })
    }
  })

  it('propagates a state-fetch failure as a thrown error', async () => {
    vi.mocked(extractActionGoal).mockResolvedValue({ protocol: 'scallop', amount: 50, action: 'supply' })
    vi.mocked(fetchPolicyState).mockRejectedValue(new Error('object not found'))

    await expect(
      translateAction('deposit 50 into scallop', {
        policyId: POLICY_ID,
        packageId: PACKAGE_ID,
        walrusBlobId: 'placeholder-blob',
        client: {} as Anthropic,
        suiClient: {} as SuiJsonRpcClient,
      }),
    ).rejects.toThrow('object not found')
  })
})
