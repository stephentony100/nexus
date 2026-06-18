import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { PolicyState } from './types.js'

export class PolicyFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyFetchError'
  }
}

function safeNumber(value: unknown, field: string, policyId: string): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n)) {
    throw new PolicyFetchError(`Object ${policyId} field ${field} (${String(value)}) is not a safe integer`)
  }
  return n
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

  if (typeof fields.agent !== 'string') {
    throw new PolicyFetchError(`Object ${policyId} has a non-string agent field`)
  }

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
    agent: fields.agent,
    maxTotalBudget: safeNumber(fields.max_total_budget, 'max_total_budget', policyId),
    spentTotal: safeNumber(fields.spent_total, 'spent_total', policyId),
    maxSingleTx: safeNumber(fields.max_single_tx, 'max_single_tx', policyId),
    allowedProtocols,
    expiresAtMs: safeNumber(fields.expires_at_ms, 'expires_at_ms', policyId),
    paused: fields.paused,
    revoked: fields.revoked,
  }
}
