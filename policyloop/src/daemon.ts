import type { DaemonConfig } from './config.js'
import { runPolicyCycle } from './index.js'
import type { PolicyLoopOptions } from './index.js'

export interface LogRecord {
  ts: string
  level: 'info' | 'warn' | 'error'
  event: string
  policyId?: string
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
  if (signal.aborted) return Promise.resolve()
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
        const isActionRecorded = result.eventKind === 'action_recorded'
        log({
          level: 'info',
          event: 'cycle_completed',
          cycleId,
          durationMs,
          status: result.status,
          digest: result.digest,
          eventKind: result.eventKind,
          ...(isActionRecorded
            ? { amountMist: result.event.amount, protocol: result.event.protocolId }
            : {}),
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

export async function runMultiPolicyDaemon(
  policies: PolicyLoopOptions[],
  config: DaemonConfig,
  signal: AbortSignal,
  onLog: (record: LogRecord) => void,
): Promise<void> {
  const { intervalMs, maxErrorDelayMs } = config

  const log = (fields: Omit<LogRecord, 'ts'>) => {
    onLog({ ts: new Date().toISOString(), ...fields } as LogRecord)
  }

  log({ level: 'info', event: 'daemon_started', intervalMs, maxErrorDelayMs, policyCount: policies.length })

  signal.addEventListener(
    'abort',
    () => {
      log({ level: 'info', event: 'daemon_stopping' })
    },
    { once: true },
  )

  while (!signal.aborted) {
    let hadThrow = false

    for (const policyOpts of policies) {
      if (signal.aborted) break

      const cycleId = randomShortId()
      const policyId = policyOpts.policyId
      log({ level: 'info', event: 'cycle_started', policyId, cycleId })
      const start = Date.now()

      try {
        const result = await runPolicyCycle(policyOpts)
        const durationMs = Date.now() - start

        if (result.status === 'skipped') {
          log({ level: 'info', event: 'cycle_skipped', policyId, cycleId, durationMs, reason: result.reason })
        } else if (result.status === 'succeeded') {
          const isActionRecorded = result.eventKind === 'action_recorded'
          log({
            level: 'info',
            event: 'cycle_completed',
            policyId,
            cycleId,
            durationMs,
            status: result.status,
            digest: result.digest,
            eventKind: result.eventKind,
            ...(isActionRecorded
              ? { amountMist: result.event.amount, protocol: result.event.protocolId }
              : {}),
          })
        } else {
          const extraFields =
            result.status === 'validation_failed'
              ? { errors: result.errors }
              : { reason: (result as { reason?: string }).reason }
          log({
            level: 'warn',
            event: 'cycle_completed',
            policyId,
            cycleId,
            durationMs,
            status: result.status,
            ...extraFields,
          })
        }
      } catch (err) {
        const durationMs = Date.now() - start
        hadThrow = true
        const backoffMs = Math.min(intervalMs * 2, maxErrorDelayMs)
        log({ level: 'error', event: 'cycle_failed', policyId, cycleId, durationMs, error: serializeError(err), backoffMs })
      }
    }

    const sleepMs = hadThrow ? Math.min(intervalMs * 2, maxErrorDelayMs) : intervalMs
    await interruptibleSleep(sleepMs, signal)
  }

  log({ level: 'info', event: 'daemon_stopped' })
}
