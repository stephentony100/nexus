import type { DaemonConfig } from './config.js'
import { runPolicyCycle } from './index.js'
import type { PolicyLoopOptions } from './index.js'

export interface LogRecord {
  ts: string
  level: 'info' | 'warn' | 'error'
  event: string
  cycleId?: string
  durationMs?: number
  [key: string]: unknown
}

function randomShortId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 8)
}

function serializeError(err: unknown): { message: string; name?: string; stack?: string } {
  return err instanceof Error
    ? { message: err.message, name: err.name, stack: err.stack }
    : { message: String(err) }
}

function interruptibleSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        resolve()
      },
      { once: true },
    )
  })
}

export async function runDaemon(
  policyOpts: PolicyLoopOptions,
  config: DaemonConfig,
  signal: AbortSignal,
  onLog: (record: LogRecord) => void,
): Promise<void> {
  const { intervalMs, maxErrorDelayMs } = config

  const log = (fields: Omit<LogRecord, 'ts'>) => {
    onLog({ ts: new Date().toISOString(), ...fields } as LogRecord)
  }

  log({ level: 'info', event: 'daemon_started', intervalMs, maxErrorDelayMs, policyId: policyOpts.policyId })

  signal.addEventListener(
    'abort',
    () => {
      log({ level: 'info', event: 'daemon_stopping' })
    },
    { once: true },
  )

  while (!signal.aborted) {
    const cycleId = randomShortId()
    log({ level: 'info', event: 'cycle_started', cycleId })
    const start = Date.now()

    try {
      const result = await runPolicyCycle(policyOpts)
      const durationMs = Date.now() - start

      if (result.status === 'skipped') {
        log({ level: 'info', event: 'cycle_skipped', cycleId, durationMs, reason: result.reason })
      } else if (result.status === 'succeeded') {
        const extraFields =
          result.eventKind === 'action_recorded' ? { protocol: result.event.protocolId } : {}
        log({
          level: 'info',
          event: 'cycle_completed',
          cycleId,
          durationMs,
          status: result.status,
          digest: result.digest,
          eventKind: result.eventKind,
          amountMist: Number(result.event.amount),
          ...extraFields,
        })
      } else {
        const extraFields =
          result.status === 'validation_failed'
            ? { errors: result.errors }
            : { reason: (result as { reason?: string }).reason }
        log({
          level: 'warn',
          event: 'cycle_completed',
          cycleId,
          durationMs,
          status: result.status,
          ...extraFields,
        })
      }

      await interruptibleSleep(intervalMs, signal)
    } catch (err) {
      const durationMs = Date.now() - start
      const backoffMs = Math.min(intervalMs * 2, maxErrorDelayMs)
      log({ level: 'error', event: 'cycle_failed', cycleId, durationMs, error: serializeError(err), backoffMs })
      await interruptibleSleep(backoffMs, signal)
    }
  }

  log({ level: 'info', event: 'daemon_stopped' })
}
