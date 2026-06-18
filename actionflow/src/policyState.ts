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
  if (!content.type.endsWith('::policy::PolicyObject')) {
    throw new PolicyFetchError(`Object ${policyId} has unexpected Move type ${content.type}`)
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

  if (typeof fields.paused !== 'boolean' || typeof fields.revoked !== 'boolean') {
    throw new PolicyFetchError(`Object ${policyId} has non-boolean paused/revoked fields`)
  }

  return {
    agent: String(fields.agent),
    maxTotalBudget: Number(fields.max_total_budget),
    spentTotal: Number(fields.spent_total),
    maxSingleTx: Number(fields.max_single_tx),
    allowedProtocols,
    expiresAtMs: Number(fields.expires_at_ms),
    paused: fields.paused,
    revoked: fields.revoked,
  }
}
