import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { fetchPolicyState, validateAction, buildRecordActionPtb } from 'actionflow'
import { loadAgentKeypair, submitTransaction } from 'agentrunner'
import type { RunActionResult } from 'agentrunner'
import { decidePolicyAction } from './decision.js'

export interface PolicyLoopOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}

export type PolicyLoopResult =
  | { ok: true; status: 'skipped'; reason: string }
  | RunActionResult

export async function runPolicyCycle(opts: PolicyLoopOptions): Promise<PolicyLoopResult> {
  const suiClient =
    opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })
  const nowMs = Date.now()

  const state = await fetchPolicyState(opts.policyId, suiClient)
  const decision = decidePolicyAction(state, nowMs)

  if (decision.kind === 'skip') {
    return { ok: true, status: 'skipped', reason: decision.reason }
  }

  const validated = validateAction(
    { protocol: decision.protocol, amount: decision.amount },
    state,
    nowMs,
    opts.policyId,
  )
  if (!validated.ok) {
    return { ok: false, status: 'validation_failed', errors: validated.errors }
  }

  const tx = buildRecordActionPtb(validated.action, opts.walrusBlobId, opts.packageId)
  const signer = opts.signer ?? loadAgentKeypair()
  tx.setSender(signer.toSuiAddress())

  return submitTransaction(tx, signer, suiClient)
}

export { decidePolicyAction } from './decision.js'
export type { PolicyDecision } from './decision.js'
