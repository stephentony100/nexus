import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PolicyLoopOptions } from './index.js'
import type { LogRecord } from './daemon.js'

vi.mock('./index.js', () => ({
  runPolicyCycle: vi.fn(),
}))

import { runPolicyCycle } from './index.js'
import { runDaemon, runMultiPolicyDaemon } from './daemon.js'

const POLICY_ID = '0x' + 'aa'.repeat(32)
const PACKAGE_ID = '0x' + '11'.repeat(32)

function baseOpts(): PolicyLoopOptions {
  return { policyId: POLICY_ID, packageId: PACKAGE_ID, walrusBlobId: 'blob' }
}

// Use long intervals so sleeps never fire naturally; abort clears them immediately.
const cfg = { intervalMs: 30_000, maxErrorDelayMs: 90_000 }

// Flush all pending microtasks so the daemon processes its current cycle
// before we abort. setImmediate fires after all microtasks drain.
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

const succeededResult = {
  ok: true as const,
  status: 'succeeded' as const,
  digest: 'abc123',
  eventKind: 'action_recorded' as const,
  event: {
    policyId: POLICY_ID,
    agent: '0x' + 'bb'.repeat(32),
    protocolId: 'scallop',
    amount: '100',
    spentTotal: '100',
    walrusBlobId: 'blob',
    timestampMs: '1700000000000',
  },
}

const POLICY_ID_B = '0x' + 'cc'.repeat(32)

function policyOpts(policyId: string): PolicyLoopOptions {
  return { policyId, packageId: PACKAGE_ID, walrusBlobId: 'blob' }
}

describe('runDaemon', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it('emits full event sequence and cycleId consistency on happy path', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValue(succeededResult)
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runDaemon(baseOpts(), cfg, ctrl.signal, (r) => logs.push(r))
    await tick()     // let runPolicyCycle resolve + daemon log cycle_completed + enter sleep
    ctrl.abort()
    await daemonPromise

    expect(logs.map((l) => l.event)).toEqual([
      'daemon_started',
      'cycle_started',
      'cycle_completed',
      'daemon_stopping',
      'daemon_stopped',
    ])

    // All cycle-scoped records share the same cycleId
    const cycleRecords = logs.filter((l) => l.cycleId !== undefined)
    expect(cycleRecords.length).toBeGreaterThan(0)
    const id = cycleRecords[0].cycleId
    expect(cycleRecords.every((l) => l.cycleId === id)).toBe(true)
    expect(typeof id).toBe('string')
    expect((id as string).length).toBe(8)

    // cycle_completed carries expected fields
    const completed = logs.find((l) => l.event === 'cycle_completed')!
    expect(completed).toMatchObject({
      level: 'info',
      status: 'succeeded',
      digest: 'abc123',
      eventKind: 'action_recorded',
      protocol: 'scallop',
      amountMist: '100',
    })
    expect(typeof completed.durationMs).toBe('number')

    // daemon_started carries config
    expect(logs[0]).toMatchObject({ level: 'info', intervalMs: 30_000, maxErrorDelayMs: 90_000, policyId: POLICY_ID })
  })

  it('emits cycle_skipped when runPolicyCycle returns skipped', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValue({ ok: true, status: 'skipped', reason: 'policy is paused' })
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runDaemon(baseOpts(), cfg, ctrl.signal, (r) => logs.push(r))
    await tick()
    ctrl.abort()
    await daemonPromise

    const skipped = logs.find((l) => l.event === 'cycle_skipped')
    expect(skipped).toBeDefined()
    expect(skipped).toMatchObject({ level: 'info', reason: 'policy is paused' })
    expect(logs.find((l) => l.event === 'cycle_failed')).toBeUndefined()
    expect(logs.find((l) => l.event === 'cycle_completed')).toBeUndefined()
  })

  it('emits cycle_failed with serializeError output and correct backoffMs when runPolicyCycle throws', async () => {
    vi.mocked(runPolicyCycle).mockRejectedValue(new Error('RPC timeout'))
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runDaemon(baseOpts(), cfg, ctrl.signal, (r) => logs.push(r))
    await tick()
    ctrl.abort()
    await daemonPromise

    const failed = logs.find((l) => l.event === 'cycle_failed')
    expect(failed).toBeDefined()
    expect(failed).toMatchObject({
      level: 'error',
      error: { message: 'RPC timeout', name: 'Error' },
      backoffMs: Math.min(cfg.intervalMs * 2, cfg.maxErrorDelayMs), // 60_000
    })
    expect(typeof (failed!.error as { stack?: string }).stack).toBe('string')
    expect(typeof failed!.durationMs).toBe('number')
  })

  it('backoff resets after recovery — cycle 2 completes without a second cycle_failed', async () => {
    vi.useFakeTimers()
    vi.mocked(runPolicyCycle)
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValue(succeededResult)

    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runDaemon(baseOpts(), cfg, ctrl.signal, (r) => logs.push(r))

    // Cycle 1: throws → catch block logs cycle_failed → enters backoff sleep
    // backoffMs = Math.min(30000 * 2, 90000) = 60000
    await vi.advanceTimersByTimeAsync(0) // flush pending microtasks (vi.runAllMicrotasksAsync not in vitest 4.x)

    // Skip past the backoff sleep
    await vi.advanceTimersByTimeAsync(60_000)
    // Cycle 2 starts: runPolicyCycle resolves → cycle_completed → enters interval sleep

    // Abort to stop the daemon
    ctrl.abort()
    await daemonPromise

    // Exactly one failure (cycle 1), exactly one success (cycle 2)
    expect(logs.filter((l) => l.event === 'cycle_failed')).toHaveLength(1)
    expect(logs.filter((l) => l.event === 'cycle_completed')).toHaveLength(1)

    // Two different cycleIds — confirms cycle 2 started fresh
    const ids = new Set(logs.filter((l) => l.cycleId).map((l) => l.cycleId))
    expect(ids.size).toBe(2)
  })

  it('exits promptly on abort during sleep without running a second cycle', async () => {
    vi.useFakeTimers()
    vi.mocked(runPolicyCycle).mockResolvedValue(succeededResult)
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runDaemon(baseOpts(), cfg, ctrl.signal, (r) => logs.push(r))

    // Flush microtasks so runPolicyCycle resolves and daemon enters interruptibleSleep.
    // Fake timers are active so the setTimeout inside sleep never fires naturally.
    await vi.advanceTimersByTimeAsync(0) // flush pending microtasks (vi.runAllMicrotasksAsync not in vitest 4.x)

    // Abort without advancing time
    ctrl.abort()
    await daemonPromise

    // Only one cycle ran
    expect(logs.filter((l) => l.event === 'cycle_started')).toHaveLength(1)
    expect(logs.at(-2)?.event).toBe('daemon_stopping')
    expect(logs.at(-1)?.event).toBe('daemon_stopped')
  })
})

describe('runMultiPolicyDaemon', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => vi.useRealTimers())

  it('runs policies sequentially and emits cycle events in order', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValue({ ok: true, status: 'skipped', reason: 'test' })
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID), policyOpts(POLICY_ID_B)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )
    await tick()
    ctrl.abort()
    await daemonPromise

    const cycleEvents = logs.filter((l) => l.event === 'cycle_started' || l.event === 'cycle_skipped')
    expect(cycleEvents[0]).toMatchObject({ event: 'cycle_started', policyId: POLICY_ID })
    expect(cycleEvents[1]).toMatchObject({ event: 'cycle_skipped', policyId: POLICY_ID })
    expect(cycleEvents[2]).toMatchObject({ event: 'cycle_started', policyId: POLICY_ID_B })
    expect(cycleEvents[3]).toMatchObject({ event: 'cycle_skipped', policyId: POLICY_ID_B })
  })

  it('includes policyId on every cycle-scoped log record', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValue({ ok: true, status: 'skipped', reason: 'test' })
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID), policyOpts(POLICY_ID_B)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )
    await tick()
    ctrl.abort()
    await daemonPromise

    const cycleRecords = logs.filter((l) => l.cycleId !== undefined)
    expect(cycleRecords.length).toBeGreaterThan(0)
    expect(cycleRecords.every((l) => l.policyId !== undefined)).toBe(true)
    expect(cycleRecords.some((l) => l.policyId === POLICY_ID)).toBe(true)
    expect(cycleRecords.some((l) => l.policyId === POLICY_ID_B)).toBe(true)
  })

  it('emits daemon_started with policyCount and daemon_stopped on exit', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValue({ ok: true, status: 'skipped', reason: 'test' })
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID), policyOpts(POLICY_ID_B)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )
    await tick()
    ctrl.abort()
    await daemonPromise

    expect(logs[0]).toMatchObject({
      level: 'info',
      event: 'daemon_started',
      policyCount: 2,
      intervalMs: cfg.intervalMs,
      maxErrorDelayMs: cfg.maxErrorDelayMs,
    })
    expect(logs.at(-1)?.event).toBe('daemon_stopped')
  })

  it('uses backoffMs for post-round sleep when any policy throws', async () => {
    vi.useFakeTimers()
    vi.mocked(runPolicyCycle)
      .mockResolvedValueOnce({ ok: true, status: 'skipped', reason: 'test' }) // policy A round 1
      .mockRejectedValueOnce(new Error('RPC timeout'))                          // policy B round 1 throws
      .mockResolvedValue({ ok: true, status: 'skipped', reason: 'test' })      // subsequent rounds
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID), policyOpts(POLICY_ID_B)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )

    // Flush: round 1 completes (policy A skips, policy B throws)
    await vi.advanceTimersByTimeAsync(0)

    // Verify cycle_failed was logged with correct backoffMs
    const failed = logs.find((l) => l.event === 'cycle_failed')
    expect(failed).toBeDefined()
    expect(failed).toMatchObject({
      level: 'error',
      policyId: POLICY_ID_B,
      backoffMs: Math.min(cfg.intervalMs * 2, cfg.maxErrorDelayMs), // 60_000
    })

    // Advance past backoffMs (60_000) — round 2 starts
    await vi.advanceTimersByTimeAsync(60_000)
    ctrl.abort()
    await daemonPromise

    // Round 2 started — proves backoff sleep expired
    expect(logs.filter((l) => l.event === 'cycle_started').length).toBeGreaterThan(2)
  })

  it('uses intervalMs sleep when all results are handled results (no throws)', async () => {
    vi.useFakeTimers()
    vi.mocked(runPolicyCycle)
      .mockResolvedValueOnce({ ok: false, status: 'upload_failed', reason: 'network timeout' })
      .mockResolvedValue({ ok: true, status: 'skipped', reason: 'test' })
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )

    // Flush: round 1 completes with upload_failed (handled result, not a throw)
    await vi.advanceTimersByTimeAsync(0)

    // Advance intervalMs = 30_000 — round 2 should start (backoffMs would be 60_000)
    await vi.advanceTimersByTimeAsync(30_000)
    ctrl.abort()
    await daemonPromise

    // Round 1 logged upload_failed as cycle_completed warn
    const warn = logs.find((l) => l.event === 'cycle_completed' && l.level === 'warn')
    expect(warn).toMatchObject({ status: 'upload_failed', reason: 'network timeout' })

    // Round 2 started — proves intervalMs sleep (not backoffMs) was used
    expect(logs.filter((l) => l.event === 'cycle_started')).toHaveLength(2)
  })

  it('skips remaining policies in round when abort fires during a policy cycle', async () => {
    const ctrl = new AbortController()
    vi.mocked(runPolicyCycle).mockImplementation(async () => {
      ctrl.abort() // abort fires during policy A
      return { ok: true, status: 'skipped', reason: 'test' }
    })
    const logs: LogRecord[] = []

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID), policyOpts(POLICY_ID_B)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )
    await tick()
    await daemonPromise

    // Policy A ran
    expect(logs.some((l) => l.event === 'cycle_started' && l.policyId === POLICY_ID)).toBe(true)
    // Policy B was never started (signal.aborted break)
    expect(logs.some((l) => l.policyId === POLICY_ID_B)).toBe(false)
    // Daemon exited cleanly
    expect(logs.at(-1)?.event).toBe('daemon_stopped')
  })

  it('emits daemon_stopping and daemon_stopped on abort with no second round', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValue({ ok: true, status: 'skipped', reason: 'test' })
    const logs: LogRecord[] = []
    const ctrl = new AbortController()

    const daemonPromise = runMultiPolicyDaemon(
      [policyOpts(POLICY_ID)],
      cfg,
      ctrl.signal,
      (r) => logs.push(r),
    )
    await tick()
    ctrl.abort()
    await daemonPromise

    const events = logs.map((l) => l.event)
    expect(events).toContain('daemon_stopping')
    expect(events.at(-1)).toBe('daemon_stopped')
    // Only one round ran
    expect(logs.filter((l) => l.event === 'cycle_started')).toHaveLength(1)
  })
})
