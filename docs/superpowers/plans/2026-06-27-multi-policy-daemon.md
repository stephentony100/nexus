# Multi-Policy Daemon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `runMultiPolicyDaemon` to `policyloop`, letting one daemon manage multiple policies sequentially with per-policy structured logging.

**Architecture:** `runMultiPolicyDaemon` lives alongside `runDaemon` in `policyloop/src/daemon.ts`, sharing the existing `randomShortId`, `serializeError`, and `interruptibleSleep` helpers. The `LogRecord` type gains an optional `policyId` field (backward-compatible). `bin/daemon.ts` detects `POLICYLOOP_POLICY_IDS` and routes to the multi-policy function; the single-policy `runDaemon` path is unchanged.

**Tech Stack:** TypeScript ESM, vitest 4.1.9, Node.js AbortSignal, existing `runPolicyCycle` from `policyloop/src/index.ts`

## Global Constraints

- Working package: `policyloop` at `C:/Users/NT/Desktop/nexus/policyloop`
- All local TypeScript imports use `.js` extension (ESM)
- No changes to `actionflow` or `agentrunner` packages
- TypeScript strict mode — `npx tsc --noEmit` must pass with zero errors in all three packages
- vitest 4.1.9 — run tests with `npx vitest run` from inside each package directory
- TDD: write the failing test first, verify it fails, then implement
- `runDaemon` (single-policy) must remain unchanged — do not modify its logic
- `amountMist` in `runMultiPolicyDaemon` logs `result.event.amount` as a raw string (not `Number(...)`) to avoid precision loss on large MIST values

---

### Task 1: `runMultiPolicyDaemon` — core logic and tests

**Files:**
- Modify: `policyloop/src/daemon.ts`
- Modify: `policyloop/src/daemon.test.ts`

**Interfaces:**
- Consumes: `runPolicyCycle` from `./index.js` (already imported), `PolicyLoopOptions`, `DaemonConfig`, `LogRecord` (all already in scope)
- Produces (used by Task 2):
  ```ts
  export async function runMultiPolicyDaemon(
    policies: PolicyLoopOptions[],
    config: DaemonConfig,
    signal: AbortSignal,
    onLog: (record: LogRecord) => void,
  ): Promise<void>
  ```

- [ ] **Step 1: Add `policyId` to `LogRecord` in `policyloop/src/daemon.ts`**

  Change only the `LogRecord` interface — add `policyId?: string` between `event` and `cycleId`. Everything else in the file stays the same.

  ```ts
  export interface LogRecord {
    ts: string
    level: 'info' | 'warn' | 'error'
    event: string
    policyId?: string      // new — present on every cycle record in multi-policy mode
    cycleId?: string
    durationMs?: number
    [key: string]: unknown
  }
  ```

- [ ] **Step 2: Write 7 failing tests in `policyloop/src/daemon.test.ts`**

  Add these at the top of the file alongside the existing imports/mocks — one new import and one new constant at module level, then a full `describe` block at the bottom:

  **Add to the existing imports block** (after `import { runDaemon } from './daemon.js'`):
  ```ts
  import { runDaemon, runMultiPolicyDaemon } from './daemon.js'
  ```
  *(Replace the existing `import { runDaemon }` line.)*

  **Add at module level** (after the existing `const succeededResult = { ... }` block):
  ```ts
  const POLICY_ID_B = '0x' + 'cc'.repeat(32)

  function policyOpts(policyId: string): PolicyLoopOptions {
    return { policyId, packageId: PACKAGE_ID, walrusBlobId: 'blob' }
  }
  ```

  **Append a new describe block at the bottom of the file:**
  ```ts
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
  ```

- [ ] **Step 3: Run tests — expect 7 new failures**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/daemon.test.ts
  ```
  Expected: the 7 new tests in `runMultiPolicyDaemon` fail; existing 5 `runDaemon` tests still pass.

- [ ] **Step 4: Implement `runMultiPolicyDaemon` in `policyloop/src/daemon.ts`**

  Add this export at the bottom of the file, after the closing `}` of `runDaemon`:

  ```ts
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
  ```

  **Do not change `runDaemon` or any of the private helpers.**

- [ ] **Step 5: Run all daemon tests — expect all to pass**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run src/daemon.test.ts
  ```
  Expected: 12 tests pass (5 existing + 7 new).

- [ ] **Step 6: Run the full policyloop suite**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run
  ```
  Expected: all tests pass (94 existing + 7 new = 101 total).

- [ ] **Step 7: Type-check**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors.

- [ ] **Step 8: Commit**

  ```
  git add policyloop/src/daemon.ts policyloop/src/daemon.test.ts
  git commit -m "feat(policyloop): add runMultiPolicyDaemon for sequential multi-policy execution"
  ```

---

### Task 2: Bin wiring — `bin/daemon.ts` multi-policy mode

**Files:**
- Modify: `policyloop/bin/daemon.ts`

**Interfaces:**
- Consumes (from Task 1): `runMultiPolicyDaemon` from `../src/daemon.js`
- No new tests — the bin is a CLI entry point; multi-policy logic is covered by Task 1's tests. Bin changes are validated by type-checking.

- [ ] **Step 1: Replace `policyloop/bin/daemon.ts`**

  The current file only handles single-policy mode. Replace it with the version below that checks `POLICYLOOP_POLICY_IDS` first and routes accordingly. The single-policy path is unchanged except it is now in an `else` branch.

  ```ts
  #!/usr/bin/env node
  import { readScallopConfig, readAiConfig, readDaemonConfig, readWalrusConfig } from '../src/config.js'
  import { WalrusUploaderImpl } from '../src/walrus.js'
  import { runDaemon, runMultiPolicyDaemon } from '../src/daemon.js'
  import type { LogRecord } from '../src/daemon.js'
  import type { PolicyLoopOptions } from '../src/index.js'
  import { loadAgentKeypair } from 'agentrunner'

  function requireEnv(name: string): string {
    const value = process.env[name]
    if (!value) {
      console.error(`Missing ${name} environment variable`)
      process.exit(1)
    }
    return value
  }

  async function main() {
    const packageId = requireEnv('ACTIONFLOW_PACKAGE_ID')

    let config
    try {
      config = readDaemonConfig()
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    let walrusConfig
    try {
      walrusConfig = readWalrusConfig()
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      process.exit(1)
    }

    // loadAgentKeypair reads AGENTRUNNER_PRIVATE_KEY
    const signer = loadAgentKeypair()

    const controller = new AbortController()
    process.once('SIGINT', () => controller.abort())
    process.once('SIGTERM', () => controller.abort())

    const onLog = (record: LogRecord) => process.stdout.write(JSON.stringify(record) + '\n')

    const policyIdsEnv = process.env.POLICYLOOP_POLICY_IDS

    if (policyIdsEnv) {
      // Multi-policy mode
      const policyIds = policyIdsEnv.split(',').map((s) => s.trim()).filter(Boolean)

      if (policyIds.length === 0) {
        console.error('POLICYLOOP_POLICY_IDS must contain at least one policy ID')
        process.exit(1)
      }

      if (!walrusConfig) {
        console.error('WALRUS_NETWORK is required in multi-policy mode (set when POLICYLOOP_POLICY_IDS is used)')
        process.exit(1)
      }

      // One uploader instance shared across all policies — WalrusClient is stateless and reusable
      const uploader = new WalrusUploaderImpl({ config: walrusConfig, signer })
      const scallop = readScallopConfig()
      const ai = readAiConfig()

      const policies: PolicyLoopOptions[] = policyIds.map((policyId) => ({
        policyId,
        packageId,
        walrus: { uploader },
        signer,
        scallop,
        ai,
      }))

      await runMultiPolicyDaemon(policies, config, controller.signal, onLog)
    } else {
      // Single-policy mode (backward compat — unchanged from Phase 2)
      const policyId = requireEnv('ACTIONFLOW_POLICY_ID')

      let walrus: PolicyLoopOptions['walrus']
      let walrusBlobId: string | undefined

      if (walrusConfig) {
        walrus = { uploader: new WalrusUploaderImpl({ config: walrusConfig, signer }) }
      } else {
        walrusBlobId = requireEnv('ACTIONFLOW_WALRUS_BLOB_ID')
      }

      const policyOpts: PolicyLoopOptions = {
        policyId,
        packageId,
        walrusBlobId,
        walrus,
        signer,
        scallop: readScallopConfig(),
        ai: readAiConfig(),
      }

      await runDaemon(policyOpts, config, controller.signal, onLog)
      // Node exits naturally — no process.exit(0)
    }
  }

  main().catch((err) => {
    console.error('Unexpected error:', err)
    process.exit(1)
  })
  ```

- [ ] **Step 2: Type-check all three packages**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/actionflow && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx tsc --noEmit
  ```
  Expected: zero errors in all three.

- [ ] **Step 3: Run the full policyloop test suite**

  ```
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run
  ```
  Expected: all 101 tests pass.

- [ ] **Step 4: Commit**

  ```
  git add policyloop/bin/daemon.ts
  git commit -m "feat(policyloop): wire multi-policy mode into daemon bin via POLICYLOOP_POLICY_IDS"
  ```

---

### Task 3: Final verification

**Files:** no changes

- [ ] **Step 1: Run all three package test suites**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx vitest run
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx vitest run
  cd C:/Users/NT/Desktop/nexus/policyloop && npx vitest run
  ```
  Expected: all tests pass.
  Minimum expected counts: actionflow 84, agentrunner 27, policyloop 101 (94 existing + 7 new).

- [ ] **Step 2: Type-check all three packages**

  ```
  cd C:/Users/NT/Desktop/nexus/actionflow && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/agentrunner && npx tsc --noEmit
  cd C:/Users/NT/Desktop/nexus/policyloop && npx tsc --noEmit
  ```
  Expected: zero errors in all three.
