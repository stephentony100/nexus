import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { PolicyState } from './types.js'

export class PolicyFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyFetchError'
  }
}

export async function fetchPolicyState(policyId: string, client: SuiJsonRpcClient): Promise<PolicyState> {
  const response = await client.getObject({ id: policyId, options: { showContent: true } })

  const content = response.data?.content
  if (!content || content.dataType !== 'moveObject') {
    throw new PolicyFetchError(`Object ${policyId} is not a PolicyObject (missing or non-Move content)`)
  }

  const fields = content.fields as Record<string, unknown>

  const allowedProtocolsRaw = fields.allowed_protocols
  if (!Array.isArray(allowedProtocolsRaw)) {
    throw new PolicyFetchError(`Object ${policyId} is missing allowed_protocols field`)
  }
  const allowedProtocols = allowedProtocolsRaw.map((bytes) => {
    if (!Array.isArray(bytes)) {
      throw new PolicyFetchError(`Object ${policyId} has a malformed allowed_protocols entry`)
    }
    return Buffer.from(bytes as number[]).toString('utf8')
  })

  return {
    agent: String(fields.agent),
    maxTotalBudget: Number(fields.max_total_budget),
    spentTotal: Number(fields.spent_total),
    maxSingleTx: Number(fields.max_single_tx),
    allowedProtocols,
    expiresAtMs: Number(fields.expires_at_ms),
    paused: Boolean(fields.paused),
    revoked: Boolean(fields.revoked),
  }
}
