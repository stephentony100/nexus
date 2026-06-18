import type { Transaction } from '@mysten/sui/transactions'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { ActionRecordedEvent, RunActionResult } from './types.js'

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

function parseActionRecordedEvent(events: { type: string; parsedJson: unknown }[]): ActionRecordedEvent | undefined {
  const event = events.find((e) => e.type.endsWith('::policy::ActionRecorded'))
  if (!event) return undefined

  const fields = event.parsedJson as Record<string, unknown>
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

export async function submitTransaction(
  tx: Transaction,
  signer: Ed25519Keypair,
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
        signer,
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

  const event = parseActionRecordedEvent(executeResult.events ?? [])
  if (!event) {
    return { ok: false, status: 'event_missing', digest }
  }

  return { ok: true, status: 'succeeded', digest, event }
}
