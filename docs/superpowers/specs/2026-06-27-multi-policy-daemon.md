# Multi-Policy Daemon — Design Spec

**Date:** 2026-06-27
**Scope:** `policyloop` package — `src/daemon.ts`, `src/daemon.test.ts`, `bin/daemon.ts`

---

## Problem

The existing `runDaemon` manages a single policy. Running multiple policies today requires multiple daemon processes with separate key files and log streams. Phase 5 makes one daemon manage an ordered list of policies: it cycles through them sequentially each round, logs every event under the relevant `policyId`, and uses one signer for all submissions.

---

## Design

### Execution model

One daemon, one signer, N policies, sequential round-robin:

```
while not aborted:
  for each policy in policies:
    run one cycle
    log result under policyId
  sleep intervalMs (or backoffMs if any policy threw)
repeat
```

One slow policy delays the next policy in the same round. This is the accepted Phase 5 tradeoff.

### Backoff rule

Post-round sleep uses `backoffMs = min(intervalMs * 2, maxErrorDelayMs)` if **any** policy in the round threw an unexpected error (`cycle_failed`). Handled results (`skipped`, `upload_failed`, `unsupported_action`, `validation_failed`, `config_missing`) use the normal `intervalMs` sleep.

### Walrus requirement

Multi-policy mode requires `WALRUS_NETWORK`. One `WalrusUploaderImpl` is constructed from the shared signer and wired into every `PolicyLoopOptions` in the list. Without a real uploader, each policy would record the same static blob ID, defeating Phase 2's per-cycle artifact goal.

Single-policy mode (`ACTIONFLOW_POLICY_ID`) retains the static `ACTIONFLOW_WALRUS_BLOB_ID` fallback for backward compatibility.

---

## Changes to `policyloop/src/daemon.ts`

### `LogRecord` — add `policyId`

```ts
export interface LogRecord {
  ts: string
  level: 'info' | 'warn' | 'error'
  event: string
  policyId?: string      // added — present on every record in multi-policy mode
  cycleId?: string
  durationMs?: number
  [key: string]: unknown
}
```

`policyId` is optional so the existing `runDaemon` signature and tests remain unchanged. `runDaemon` already emits `policyId` on `daemon_started` via the spread — no change needed there.

### New export: `runMultiPolicyDaemon`

```ts
export async function runMultiPolicyDaemon(
  policies: PolicyLoopOptions[],
  config: DaemonConfig,
  signal: AbortSignal,
  onLog: (record: LogRecord) => void,
): Promise<void>
```

**Startup:**

```ts
log({ level: 'info', event: 'daemon_started', intervalMs, maxErrorDelayMs, policyCount: policies.length })

signal.addEventListener('abort', () => {
  log({ level: 'info', event: 'daemon_stopping' })
}, { once: true })
```

**Round loop:**

```ts
while (!signal.aborted) {
  let hadThrow = false

  for (const policyOpts of policies) {
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
            ? { amountMist: Number(result.event.amount), protocol: result.event.protocolId }
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
```

`randomShortId`, `serializeError`, and `interruptibleSleep` are shared with `runDaemon` — no duplication.

---

## Changes to `policyloop/src/daemon.test.ts`

New `describe('runMultiPolicyDaemon', () => { ... })` block. Uses the same `vi.mock('./index.js')` and `tick`/`vi.advanceTimersByTimeAsync` patterns from the existing suite.

**Tests:**

1. **Sequential event order** — two policies produce `cycle_started(A), cycle_completed(A), cycle_started(B), cycle_completed(B)` in one round
2. **`policyId` on every cycle record** — each `cycle_started` and `cycle_completed` carries the matching `policyId`
3. **`daemon_started` includes `policyCount`** — `policyCount: 2` appears in the first log record
4. **Backoff after any throw** — policy B throws; post-round sleep uses `backoffMs = min(intervalMs*2, maxErrorDelayMs)`; policy A (which succeeded) did not cause backoff on its own
5. **Normal sleep after handled result** — policy A returns `upload_failed` (no throw); post-round sleep uses `intervalMs`
6. **Abort exits cleanly** — abort after round 1 produces `daemon_stopping` + `daemon_stopped`, no second round

---

## Changes to `policyloop/bin/daemon.ts`

### Mode detection

```ts
const policyIdsEnv = process.env.POLICYLOOP_POLICY_IDS

if (policyIdsEnv) {
  // Multi-policy mode
  const policyIds = policyIdsEnv.split(',').map((s) => s.trim()).filter(Boolean)

  if (!walrusConfig) {
    console.error('WALRUS_NETWORK is required in multi-policy mode (set when POLICYLOOP_POLICY_IDS is used)')
    process.exit(1)
  }

  const policies: PolicyLoopOptions[] = policyIds.map((policyId) => ({
    policyId,
    packageId,
    walrus: { uploader: new WalrusUploaderImpl({ config: walrusConfig, signer }) },
    signer,
    scallop: readScallopConfig(),
    ai: readAiConfig(),
  }))

  await runMultiPolicyDaemon(policies, config, controller.signal, onLog)
} else {
  // Single-policy mode (backward compat)
  const policyId = requireEnv('ACTIONFLOW_POLICY_ID')
  // ... existing runDaemon path unchanged ...
}
```

`ACTIONFLOW_PACKAGE_ID` is required in both modes (shared Move package address).

`ACTIONFLOW_POLICY_ID` is only required in single-policy mode.

---

## Environment variables

| Variable | Mode | Required | Notes |
|---|---|---|---|
| `ACTIONFLOW_PACKAGE_ID` | both | yes | Move package address |
| `POLICYLOOP_POLICY_IDS` | multi | yes | Comma-separated policy object IDs |
| `ACTIONFLOW_POLICY_ID` | single | yes | Single policy object ID |
| `WALRUS_NETWORK` | multi | yes | `testnet` or `mainnet` |
| `WALRUS_NETWORK` | single | no | Falls back to static blob |
| `ACTIONFLOW_WALRUS_BLOB_ID` | single | yes (if WALRUS_NETWORK unset) | Static fallback |
| `AGENTRUNNER_PRIVATE_KEY` | both | yes | Signer keypair |

---

## What is NOT in scope

- Per-policy interval configuration — all policies share the same `DaemonConfig`
- Per-policy AI or Scallop config — same `readAiConfig()` / `readScallopConfig()` for all
- Per-policy Walrus epochs/deletable — same uploader with default settings for all
- Parallelism — sequential only
- Policy hot-reload — policies list fixed at startup
