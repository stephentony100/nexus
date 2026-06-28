import type { Transaction } from '@mysten/sui/transactions'
import type { Signer } from '@mysten/sui/cryptography'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { TransactionSigner } from './signer.js'
import type { ActionRecordedEvent, RunActionResult, ScallopSuiSuppliedEvent } from './types.js'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_DELAY_MS)
      }
    }
  }
  throw lastError
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

type ParsedEvent =
  | { kind: 'action_recorded'; event: ActionRecordedEvent }
  | { kind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }

function parseActionRecordedEvent(fields: Record<string, unknown>): ActionRecordedEvent {
  return {
    policyId: String(fields.policy_id),
    agent: String(fields.agent),
    protocolId: Buffer.from(fields.protocol_id as number[]).toString('utf8'),
    amount: String(fields.amount),
    spentTotal: String(fields.spent_total),
    walrusBlobId: Buffer.from(fields.walrus_blob_id as number[]).toString('utf8'),
    timestampMs: String(fields.timestamp_ms),
  }
}

function parseScallopSuiSuppliedEvent(fields: Record<string, unknown>): ScallopSuiSuppliedEvent {
  return {
    policyId: String(fields.policy_id),
    agent: String(fields.agent),
    amount: String(fields.amount),
    spentTotal: String(fields.spent_total),
    vaultBalance: String(fields.vault_balance),
    scallopPositionBalance: String(fields.scallop_position_balance),
    walrusBlobId: Buffer.from(fields.walrus_blob_id as number[]).toString('utf8'),
    timestampMs: String(fields.timestamp_ms),
  }
}

function parseEvent(events: { type: string; parsedJson: unknown }[]): ParsedEvent | undefined {
  const scallopEvent = events.find((e) => e.type.endsWith('::policy::ScallopSuiSupplied'))
  if (scallopEvent) {
    return { kind: 'scallop_sui_supplied', event: parseScallopSuiSuppliedEvent(scallopEvent.parsedJson as Record<string, unknown>) }
  }

  const actionEvent = events.find((e) => e.type.endsWith('::policy::ActionRecorded'))
  if (actionEvent) {
    return { kind: 'action_recorded', event: parseActionRecordedEvent(actionEvent.parsedJson as Record<string, unknown>) }
  }

  return undefined
}

export async function submitTransaction(
  tx: Transaction,
  signer: TransactionSigner,
  suiClient: SuiJsonRpcClient,
): Promise<RunActionResult> {
  let prep: { bytes: Uint8Array; dryRun: Awaited<ReturnType<typeof suiClient.dryRunTransactionBlock>> }
  try {
    prep = await withRetry(async () => {
      const bytes = await tx.build({ client: suiClient })
      const dryRun = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes })
      return { bytes, dryRun }
    })
  } catch (error) {
    return { ok: false, status: 'submission_failed', stage: 'dry_run', reason: errorMessage(error) }
  }

  if (prep.dryRun.effects.status.status === 'failure') {
    return { ok: false, status: 'simulation_failed', reason: prep.dryRun.effects.status.error ?? 'unknown abort' }
  }

  let executeResult: Awaited<ReturnType<typeof suiClient.signAndExecuteTransaction>>
  try {
    executeResult = await withRetry(() =>
      suiClient.signAndExecuteTransaction({
        transaction: prep.bytes,
        signer: signer as unknown as Signer,
        options: { showEffects: true, showEvents: true },
      }),
    )
  } catch (error) {
    return { ok: false, status: 'submission_failed', stage: 'execute', reason: errorMessage(error) }
  }

  const digest = executeResult.digest

  if (!executeResult.effects || executeResult.effects.status.status === 'failure') {
    return {
      ok: false,
      status: 'execution_aborted',
      digest,
      reason: executeResult.effects?.status.error ?? 'unknown abort',
    }
  }

  const parsed = parseEvent(executeResult.events ?? [])
  if (!parsed) {
    return { ok: false, status: 'event_missing', digest }
  }

  if (parsed.kind === 'scallop_sui_supplied') {
    return { ok: true, status: 'succeeded', digest, eventKind: 'scallop_sui_supplied', event: parsed.event }
  }
  return { ok: true, status: 'succeeded', digest, eventKind: 'action_recorded', event: parsed.event }
}
