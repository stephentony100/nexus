import Anthropic from '@anthropic-ai/sdk'
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from '@mysten/sui/jsonRpc'
import { extractActionGoal, ExtractionRefusedError } from './extractor.js'
import type { RawActionGoal } from './extractor.js'
import { fetchPolicyState } from './policyState.js'
import { validateAction } from './validator.js'
import { buildActionPtb } from './ptbBuilder.js'
import type { ScallopConfig, TranslateActionResult } from './types.js'

export interface TranslateActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  scallop?: ScallopConfig
  client?: Anthropic
  suiClient?: SuiJsonRpcClient
}

export async function translateAction(
  goal: string,
  opts: TranslateActionOptions,
): Promise<TranslateActionResult> {
  const client = opts.client ?? new Anthropic()
  const suiClient = opts.suiClient ?? new SuiJsonRpcClient({ url: getJsonRpcFullnodeUrl('testnet'), network: 'testnet' })

  let raw: RawActionGoal
  try {
    raw = await extractActionGoal(goal, client)
  } catch (error) {
    if (error instanceof ExtractionRefusedError) {
      return { ok: false, errors: [{ field: '_root', reason: 'could not parse goal' }] }
    }
    throw error
  }

  const state = await fetchPolicyState(opts.policyId, suiClient)

  const validated = validateAction(raw, state, Date.now(), opts.policyId)
  if (!validated.ok) {
    return validated
  }

  const built = buildActionPtb(validated.action, opts.walrusBlobId, opts.packageId, opts.scallop)
  if (!built.ok) {
    return built
  }

  const bytes = await built.tx.build({ onlyTransactionKind: true, client: suiClient })
  const ptbBytes = Buffer.from(bytes).toString('base64')

  return { ok: true, action: validated.action, ptbBytes }
}

export { extractActionGoal, ExtractionRefusedError } from './extractor.js'
export { fetchPolicyState, PolicyFetchError } from './policyState.js'
export { validateAction } from './validator.js'
export { buildAuditOnlyRecordPtb, buildScallopSupplySuiPtb, buildActionPtb } from './ptbBuilder.js'
export type { BuildActionPtbResult } from './ptbBuilder.js'
export type { RawActionGoal } from './extractor.js'
export type {
  PolicyState,
  PolicyAction,
  ScallopConfig,
  FieldError,
  ValidationResult,
  TranslateActionResult,
} from './types.js'
