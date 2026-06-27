# DeepBook Safety Fix — Design Spec

**Date:** 2026-06-27
**Scope:** `actionflow` package — `src/validator.ts`, `src/ptbBuilder.ts`, `src/types.ts` (minor), `src/index.ts`; `agentrunner/src/types.ts`

---

## Problem

`buildActionPtb` silently falls back to `buildRecordActionPtb` for any protocol/action combination it does not recognise. This means:

- If the AI selects `deepbook + supply`, a bookkeeping-only PTB is built and submitted on-chain.
- The `ActionRecorded` event is emitted, implying a DeFi action happened.
- No funds actually moved. The log is misleading.

The key invariant that must hold:

> **No unsupported protocol/action pair may result in a bookkeeping-only PTB.**

---

## Approach: Defense in Depth (Approach B)

Two independent protection layers:

```
validateAction         ← rejects known invalid business cases early (named, user-facing errors)
    ↓
buildActionPtb         ← refuses to build unsupported combos (safety net, never reached if validator is correct)
```

Each layer has a distinct responsibility:

- **`validation_failed`** (validator): the action is understood but violates a business or protocol rule. Example: `deepbook + supply` (DeepBook has no supply action), `scallop + withdraw` (not implemented on-chain). Future contributors add new protocol restrictions here.
- **`unsupported_action`** (router): the router has no implementation for this protocol/action combination. This is the catch-all for anything that slips through or is added to `allowedProtocols` before a builder exists. Future contributors add new protocol builders here.

---

## Changes

### 1. `actionflow/src/validator.ts` — explicit rejection of known invalid combos

Add one guard alongside the existing `scallop + withdraw` rule:

```ts
if (protocol === 'deepbook' && action === 'supply') {
  errors.push({
    field: 'action',
    reason: "deepbook does not support 'supply'; use 'swap' or 'place_limit_order'",
  })
}
```

This is a business rule: DeepBook is an order-book DEX, not a lending protocol. "Supply" has no meaning there.

### 2. `actionflow/src/ptbBuilder.ts` — strict router, no silent fallback

**Rename:** `buildRecordActionPtb` → `buildAuditOnlyRecordPtb`. No behavior change — the rename signals that this function is for audit/test/dry-run use, not real DeFi execution.

**Add to `BuildActionPtbResult`:**
```ts
| { ok: false; status: 'unsupported_action'; reason: string }
```

**Replace the router's fallback** with a hard return:

```ts
export function buildActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig | undefined,
  policyInitialSharedVersion?: string | number,
): BuildActionPtbResult {
  if (action.protocol === 'scallop' && action.action === 'supply') {
    if (!scallop) {
      return { ok: false, status: 'config_missing', reason: 'scallop config required for scallop supply' }
    }
    return { ok: true, tx: buildScallopSupplySuiPtb(action, walrusBlobId, packageId, scallop, policyInitialSharedVersion) }
  }
  return {
    ok: false,
    status: 'unsupported_action',
    reason: `no PTB builder for protocol "${action.protocol}" action "${action.action}"`,
  }
}
```

`buildAuditOnlyRecordPtb` is **not called** from the router. It remains exported for audit tooling, tests, and future non-fund-moving actions.

### 3. `actionflow/src/index.ts` — export rename

Update re-export: `buildAuditOnlyRecordPtb` replaces `buildRecordActionPtb`.

### 4. `agentrunner/src/types.ts` — add `unsupported_action` to `RunActionResult`

```ts
| { ok: false; status: 'unsupported_action'; reason: string }
```

This allows `policyloop/src/index.ts` to return the status directly from `buildActionPtb` without a type error — same pattern as `config_missing` already uses.

---

## How `policyloop` handles `unsupported_action`

`unsupported_action` is a **handled operational result**, not an exception. In `policyloop/src/index.ts`:

```ts
const built = buildActionPtb(validated.action, opts.walrusBlobId, opts.packageId, opts.scallop)
if (!built.ok) {
  return built  // returns unsupported_action, config_missing, etc.
}
```

The daemon's existing `cycle_completed` handler covers all `ok: false` results with a `warn` log:

```
cycle_completed { level: 'warn', status: 'unsupported_action', reason: '...' }
```

The daemon sleeps normally and continues the next cycle. It does **not** throw, so it never triggers `cycle_failed` or the error backoff path.

---

## Tests

### Validator (`actionflow/src/validator.test.ts`)

- `deepbook + supply` with deepbook in `allowedProtocols` → `validation_failed` with the exact error message "deepbook does not support 'supply'; use 'swap' or 'place_limit_order'"

### PTB builder (`actionflow/src/ptbBuilder.test.ts`)

- Unknown protocol (e.g. `{ protocol: 'navi', action: 'supply' }`) → `{ ok: false, status: 'unsupported_action' }`
- `scallop + supply` still routes to `buildScallopSupplySuiPtb` (regression guard)
- **Regression test for removed fallback:** assert that an unsupported protocol/action combination never calls `buildAuditOnlyRecordPtb`. This can be implemented by spying on `buildAuditOnlyRecordPtb` and asserting it is not called when an unrecognised action is passed to `buildActionPtb`.
- All existing tests referencing `buildRecordActionPtb` updated to `buildAuditOnlyRecordPtb`

---

## What is NOT in scope

- DeepBook `swap` or `place_limit_order` action types — those require their own spec, Move adapter, and PTB builder.
- Any change to `buildAuditOnlyRecordPtb` internals.
- Changes to the Move contract.
- Changes to `policyloop/src/daemon.ts` — the existing `cycle_completed` warn path already handles `ok: false` results generically.
