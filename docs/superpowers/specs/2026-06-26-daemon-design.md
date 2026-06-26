# PolicyLoop Daemon — Design Spec

**Date:** 2026-06-26
**Scope:** `policyloop` package — new `src/config.ts`, `src/daemon.ts`, `bin/daemon.ts`; minor refactor of `bin/policyloop.ts`

---

## Overview

Add a long-running daemon that continuously runs `runPolicyCycle` on a configurable interval. The one-shot CLI (`bin/policyloop.ts`) is unchanged in behavior. The daemon is a separate binary with its own lifecycle: startup validation, interruptible sleep between cycles, bounded backoff on unexpected errors, graceful shutdown on `SIGINT`/`SIGTERM`, and structured JSON line logging.

---

## Architecture

```
bin/policyloop.ts     ← one-shot cycle (unchanged behavior)
bin/daemon.ts         ← entry point: env validation, signal wiring, stdout JSON
src/config.ts         ← shared env-reading helpers (extracted from bin/policyloop.ts)
src/daemon.ts         ← loop logic: runDaemon(), log types, interruptibleSleep (internal)
src/daemon.test.ts    ← loop behavior tests (vi.mock + onLog callback + fake timers)
```

**Split of responsibilities:**
- `src/config.ts` — all `process.env` reading, config validation, shared between both binaries
- `src/daemon.ts` — pure loop logic, no `process` I/O, takes `onLog` callback (testable)
- `bin/daemon.ts` — thin shell: validates env, wires `SIGINT`/`SIGTERM` to `AbortController`, writes JSON lines to `process.stdout`

---

## `src/config.ts` — shared env-reading

Extracts what is currently inlined in `bin/policyloop.ts`, and adds daemon-specific config.

```ts
export function readScallopConfig(): ScallopConfig | undefined
export function readAiConfig(): { client: Anthropic; marketContext?: string; throwOnAiFailure: boolean } | undefined
export function readDaemonConfig(): DaemonConfig
```

`readDaemonConfig` reads:
- `POLICYLOOP_INTERVAL_MS` → `number`, default `60_000`
- `POLICYLOOP_MAX_ERROR_DELAY_MS` → `number`, default `intervalMs * 3`

**Validation (throws on startup if invalid):**
```ts
if (intervalMs <= 0) throw new Error('POLICYLOOP_INTERVAL_MS must be > 0')
if (maxErrorDelayMs < intervalMs) throw new Error('POLICYLOOP_MAX_ERROR_DELAY_MS must be >= POLICYLOOP_INTERVAL_MS')
```

`bin/policyloop.ts` is updated to import `readScallopConfig` and `readAiConfig` from `../src/config.js`. Zero behavior change.

---

## `src/daemon.ts` — loop logic

### Types

```ts
export interface DaemonConfig {
  intervalMs: number
  maxErrorDelayMs: number
}

export interface LogRecord {
  ts: string                    // ISO 8601
  level: 'info' | 'warn' | 'error'
  event: string
  cycleId?: string              // present for all cycle-scoped events
  durationMs?: number
  [key: string]: unknown        // event-specific fields
}
```

### `runDaemon` signature

```ts
export async function runDaemon(
  policyOpts: PolicyLoopOptions,
  config: DaemonConfig,
  signal: AbortSignal,
  onLog: (record: LogRecord) => void,
): Promise<void>
```

### Loop structure

```
emit daemon_started { intervalMs, maxErrorDelayMs, policyId }

// daemon_stopping is emitted immediately on abort via a one-time abort listener
// registered before the loop starts, so it fires even if the abort happens mid-sleep
signal.addEventListener('abort', () => emit daemon_stopping, { once: true })

while not signal.aborted:
  cycleId = randomShortId()        // 8 hex chars from crypto.randomUUID()
  emit cycle_started { cycleId }
  start = Date.now()

  try:
    result = await runPolicyCycle(policyOpts)
    durationMs = Date.now() - start

    if result.status === 'succeeded':
      emit cycle_completed { level: 'info', cycleId, durationMs, status, protocol, amountMist, digest, eventKind, reasoning? }
      // reasoning and marketContextPresent included only if present on result
    else if result.status === 'skipped':
      emit cycle_skipped { level: 'info', cycleId, durationMs, reason, errorType? }
    else:
      emit cycle_completed { level: 'warn', cycleId, durationMs, status, errors? }   // validation_failed etc.

    await interruptibleSleep(intervalMs, signal)

  catch err:
    durationMs = Date.now() - start
    backoffMs = Math.min(intervalMs * 2, maxErrorDelayMs)
    emit cycle_failed { level: 'error', cycleId, durationMs, error: serializeError(err), backoffMs }
    await interruptibleSleep(backoffMs, signal)

emit daemon_stopped { level: 'info' }
```

**`serializeError` helper (internal):**
```ts
function serializeError(err: unknown): { message: string; name?: string; stack?: string } {
  return err instanceof Error
    ? { message: err.message, name: err.name, stack: err.stack }
    : { message: String(err) }
}
```

**`reasoning` field:** Only included in `cycle_completed` if it is present on the `runPolicyCycle` result. The daemon does not reconstruct or infer it.

**Backoff:** flat formula, no streak counter. Backoff only on unexpected throws — handled `PolicyLoopResult` values (including `skipped`) always use the normal interval.

### Log event catalogue

| `event` | `level` | Key fields |
|---|---|---|
| `daemon_started` | info | `intervalMs`, `maxErrorDelayMs`, `policyId` |
| `cycle_started` | info | `cycleId` |
| `cycle_completed` | info (succeeded) / warn (other handled errors) | `cycleId`, `durationMs`, `status`, `protocol`?, `amountMist`?, `digest`?, `eventKind`?, `errors`? |
| `cycle_skipped` | info | `cycleId`, `durationMs`, `reason`, `errorType`? |
| `cycle_failed` | error | `cycleId`, `durationMs`, `error`, `backoffMs` |
| `daemon_stopping` | info | — |
| `daemon_stopped` | info | — |

For AI-driven cycles that succeed, `reasoning` and `marketContextPresent: boolean` are included in `cycle_completed` only if present on the result — the daemon does not reconstruct them.

### `interruptibleSleep` (internal)

Not exported. Resolves when the timeout fires or the signal is aborted — whichever comes first. Uses `AbortSignal`'s `abort` event with `{ once: true }` to clean up the listener.

---

## `bin/daemon.ts` — entry point

```
#!/usr/bin/env node
1. Validate required env vars (same as policyloop.ts: ACTIONFLOW_POLICY_ID, ACTIONFLOW_PACKAGE_ID,
   ACTIONFLOW_WALRUS_BLOB_ID, AGENTRUNNER_PRIVATE_KEY) — exit(1) on missing
2. Build DaemonConfig via readDaemonConfig() — throws on invalid config
3. Build PolicyLoopOptions from readScallopConfig() + readAiConfig() + policyId etc.
4. const controller = new AbortController()
5. process.on('SIGINT', () => controller.abort())
   process.on('SIGTERM', () => controller.abort())
6. const onLog = (record) => process.stdout.write(JSON.stringify(record) + '\n')
7. await runDaemon(policyOpts, config, controller.signal, onLog)
   // Node exits naturally after runDaemon resolves — no process.exit(0) needed
   // process.exit(1) is only used for startup validation failures (steps 1–2)
```

All daemon lifecycle logs (`daemon_started`, `daemon_stopping`, `daemon_stopped`) are emitted inside `runDaemon` — `bin/daemon.ts` does not emit any log records itself.

---

## `package.json` scripts

Add:
```json
"daemon": "tsx bin/daemon.ts"
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `POLICYLOOP_INTERVAL_MS` | `60000` | Sleep duration between cycles (ms) |
| `POLICYLOOP_MAX_ERROR_DELAY_MS` | `intervalMs * 3` | Cap on backoff sleep after unexpected errors |
| (all existing vars) | — | `ACTIONFLOW_POLICY_ID`, `ACTIONFLOW_PACKAGE_ID`, `ACTIONFLOW_WALRUS_BLOB_ID`, `AGENTRUNNER_PRIVATE_KEY`, `ANTHROPIC_API_KEY`, `POLICYLOOP_MARKET_CONTEXT`, `POLICYLOOP_THROW_ON_AI_FAILURE`, Scallop vars |

---

## Test Plan — `src/daemon.test.ts`

Mocks `./index.js` (runPolicyCycle) via `vi.mock`. Captures log records via `onLog`. Uses `vi.useFakeTimers()` for sleep assertions. AbortController stops the loop after N cycles.

**Tests:**

1. **Happy path** — `runPolicyCycle` returns `succeeded` → emits `daemon_started`, `cycle_started`, `cycle_completed` (with `protocol`, `amountMist`, `digest`, `durationMs`). After abort: `daemon_stopping` + `daemon_stopped`. All cycle-scoped records share the same `cycleId`.

2. **Skip result** — returns `skipped` → emits `cycle_skipped` with `reason`; uses `intervalMs` sleep (not backoff).

3. **Unexpected throw** — `runPolicyCycle` rejects → emits `cycle_failed` with `error` message and `backoffMs = Math.min(intervalMs * 2, maxErrorDelayMs)`.

4. **Backoff resets after recovery** — throw on cycle 1, success on cycle 2 → cycle 2 emits no `cycle_failed`, uses `intervalMs` sleep.

5. **Abort during sleep** — after the first cycle completes and the interruptible sleep begins, call `controller.abort()` while fake timers have not yet advanced (so the sleep would not naturally resolve). Assert: no second `cycle_started` emitted, `daemon_stopping` + `daemon_stopped` emitted, loop exits promptly.

6. **Config validation** — `readDaemonConfig` throws for: `POLICYLOOP_INTERVAL_MS=0`; `POLICYLOOP_MAX_ERROR_DELAY_MS` less than `intervalMs`; `POLICYLOOP_INTERVAL_MS=abc` (non-numeric → `NaN`); `POLICYLOOP_MAX_ERROR_DELAY_MS=abc` (non-numeric → `NaN`).

**`cycleId` invariant:** In every test that runs a cycle, assert all log records emitted during that cycle carry the same `cycleId`.

---

## Out of Scope (Phase 4)

- Multi-policy monitoring (Phase 5)
- Adaptive per-result intervals (the `scheduler.nextDelay(result)` hook is structurally available but not implemented)
- Prometheus / metrics endpoints
- Log rotation or file output
