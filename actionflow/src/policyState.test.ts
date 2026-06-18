import { describe, expect, it, vi } from 'vitest'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import { fetchPolicyState, PolicyFetchError } from './policyState.js'

function mockClient(getObjectResult: unknown): SuiJsonRpcClient {
  return {
    getObject: vi.fn().mockResolvedValue(getObjectResult),
  } as unknown as SuiJsonRpcClient
}

function scallopBytes(): number[] {
  return Array.from(new TextEncoder().encode('scallop'))
}

describe('fetchPolicyState', () => {
  it('parses a well-formed PolicyObject response', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    const state = await fetchPolicyState('0xpolicy', client)

    expect(state).toEqual({
      agent: '0xagent',
      maxTotalBudget: 500,
      spentTotal: 100,
      maxSingleTx: 100,
      allowedProtocols: ['scallop'],
      expiresAtMs: 1700000000000,
      paused: false,
      revoked: false,
    })
  })

  it('throws PolicyFetchError when content is missing', async () => {
    const client = mockClient({ data: { objectId: '0xpolicy' } })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when allowed_protocols is malformed', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when the Move type is not a PolicyObject', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::coin::Coin',
          fields: {
            agent: '0xagent',
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when paused/revoked are not booleans', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: undefined,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when agent is not a string', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: undefined,
            max_total_budget: '500',
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when a u64 field exceeds safe integer precision', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: '18446744073709551615',
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })

  it('throws PolicyFetchError when a u64 field is missing (would otherwise be NaN)', async () => {
    const client = mockClient({
      data: {
        objectId: '0xpolicy',
        content: {
          dataType: 'moveObject',
          type: '0x123::policy::PolicyObject',
          fields: {
            agent: '0xagent',
            max_total_budget: undefined,
            spent_total: '100',
            max_single_tx: '100',
            allowed_protocols: [scallopBytes()],
            expires_at_ms: '1700000000000',
            paused: false,
            revoked: false,
          },
        },
      },
    })

    await expect(fetchPolicyState('0xpolicy', client)).rejects.toThrow(PolicyFetchError)
  })
})
