import { translateAction } from 'actionflow'
import type { TranslateActionOptions } from 'actionflow'
import { Transaction } from '@mysten/sui/transactions'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { loadAgentKeypair } from './signer.js'
import { submitTransaction } from './submitter.js'
import type { RunActionOptions, RunActionResult } from './types.js'

export async function runAction(goal: string, opts: RunActionOptions): Promise<RunActionResult> {
  const suiClient = opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

  const translateOpts: TranslateActionOptions = {
    policyId: opts.policyId,
    packageId: opts.packageId,
    walrusBlobId: opts.walrusBlobId,
    scallop: opts.scallop,
    client: opts.client,
    suiClient,
  }

  const translated = await translateAction(goal, translateOpts)
  if (!translated.ok) {
    if ('status' in translated) {
      return translated
    }
    return { ok: false, status: 'validation_failed', errors: translated.errors }
  }

  const signer = opts.signer ?? loadAgentKeypair()
  const tx = Transaction.fromKind(translated.ptbBytes)
  tx.setSender(signer.toSuiAddress())

  return submitTransaction(tx, signer, suiClient)
}

export { loadAgentKeypair } from './signer.js'
export { submitTransaction } from './submitter.js'
export type { ActionRecordedEvent, RunActionOptions, RunActionResult, ScallopSuiSuppliedEvent } from './types.js'
