import type Anthropic from '@anthropic-ai/sdk'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { FieldError } from 'actionflow'

export interface ActionRecordedEvent {
  policyId: string
  agent: string
  protocolId: string
  amount: string
  spentTotal: string
  walrusBlobId: string
  timestampMs: string
}

export type RunActionResult =
  | { ok: true; status: 'succeeded'; digest: string; event: ActionRecordedEvent }
  | { ok: false; status: 'validation_failed'; errors: FieldError[] }
  | { ok: false; status: 'simulation_failed'; reason: string }
  | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
  | { ok: false; status: 'event_missing'; digest: string }
  | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }

export interface RunActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  client?: Anthropic
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}
