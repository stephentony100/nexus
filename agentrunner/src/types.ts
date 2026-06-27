import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { FieldError, ScallopConfig, TranslateActionOptions } from 'actionflow'

export interface ActionRecordedEvent {
  policyId: string
  agent: string
  protocolId: string
  amount: string
  spentTotal: string
  walrusBlobId: string
  timestampMs: string
}

export interface ScallopSuiSuppliedEvent {
  policyId: string
  agent: string
  amount: string
  spentTotal: string
  vaultBalance: string
  scallopPositionBalance: string
  walrusBlobId: string
  timestampMs: string
}

export type RunActionResult =
  | { ok: true; status: 'succeeded'; digest: string; eventKind: 'action_recorded'; event: ActionRecordedEvent }
  | { ok: true; status: 'succeeded'; digest: string; eventKind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }
  | { ok: false; status: 'validation_failed'; errors: FieldError[] }
  | { ok: false; status: 'config_missing'; reason: string }
  | { ok: false; status: 'unsupported_action'; reason: string }
  | { ok: false; status: 'simulation_failed'; reason: string }
  | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
  | { ok: false; status: 'event_missing'; digest: string }
  | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }

export interface RunActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  scallop?: ScallopConfig
  client?: TranslateActionOptions['client']
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}
