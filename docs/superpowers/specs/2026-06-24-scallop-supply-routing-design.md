# Nexus Scallop Supply Routing Design

## Source Of Truth

This design follows `Nexus.md` and builds on `docs/superpowers/specs/2026-06-19-scallop-sui-supply-adapter-design.md`, which added `nexus_agent_wallet::scallop_adapter::supply_sui`, a real on-chain Scallop SUI lending supply adapter, but left ActionFlow, AgentRunner, and PolicyLoop calling only `policy::record_action` (bookkeeping, no fund movement).

This phase wires the TypeScript pipeline so a "scallop supply" decision or goal actually calls `scallop_adapter::supply_sui`, completing the first real-money path described in `Nexus.md`'s "What Nexus actually does."

## Scope

Update ActionFlow, AgentRunner, and PolicyLoop so that:

- a goal or autonomous decision naming Scallop + a supply direction builds and submits a PTB calling `scallop_adapter::supply_sui`
- any other protocol (e.g. `deepbook`, which has no real adapter yet) keeps using `policy::record_action` exactly as today
- a goal naming Scallop with an unsupported direction (withdraw/redeem) is rejected with a clear validation error instead of silently being treated as a deposit

This phase does not implement Scallop redeem, a DeepBook adapter, real Walrus storage, or mainnet deployment automation. `nexus_agent_wallet` is assumed to already be published; this phase only wires the TypeScript layer to call whatever package ID and Scallop object IDs are configured.

## Network

Scallop's lending protocol has no Sui testnet deployment, and `nexus_agent_wallet`'s Move dependency is pinned via mainnet dependency resolution. There is no way to exercise the real adapter except against Sui mainnet. This phase targets mainnet, using small real SUI amounts for verification. All mainnet object IDs are supplied via configuration (see below), never hardcoded.

## Data Model Changes

### ActionFlow (`actionflow/src/extractor.ts`, `types.ts`)

`RawActionGoalSchema` gains a third field:

```ts
action: z.enum(['supply', 'withdraw']).nullable()
```

Extracted the same way `protocol`/`amount` are: only when the user explicitly stated a direction, never guessed or defaulted. The system prompt is updated to describe `action` alongside `protocol` and `amount`.

`PolicyAction` gains:

```ts
action: 'supply' | 'withdraw'
```

### Validation (`actionflow/src/validator.ts`)

`validateAction` requires `action` to be non-null (same treatment as `protocol`/`amount`: `null` produces a field error). After the existing checks, add:

```
if (protocol === 'scallop' && action !== 'supply') {
  errors.push({ field: 'action', reason: `scallop ${action} is not supported on-chain yet` })
}
```

This is the only place direction is enforced. Non-Scallop protocols accept either direction value without interpretation, since they still route to bookkeeping-only `record_action` regardless of direction.

### PolicyLoop (`policyloop/src/decision.ts`)

`PolicyDecision`'s `propose` variant gains `action: 'supply'`, hardcoded — `decidePolicyAction` has no text goal to parse and its only real capability today is supplying into an allowed protocol, so it declares that directly:

```ts
export type PolicyDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'propose'; protocol: string; amount: number; action: 'supply' }
```

## Scallop Configuration

New type, exported from `actionflow`:

```ts
export interface ScallopConfig {
  versionObjectId: string
  marketObjectId: string
  versionInitialSharedVersion?: string | number
  marketInitialSharedVersion?: string | number
}
```

`TranslateActionOptions`, `RunActionOptions` (agentrunner), and `PolicyLoopOptions` (policyloop) each gain:

```ts
scallop?: ScallopConfig
```

Optional, because a policy that only allows `deepbook` should never be forced to supply mainnet Scallop object IDs.

CLI/env wiring in `agentrunner/bin/agentrunner.ts` and `policyloop/bin/policyloop.ts`: read `SCALLOP_VERSION_OBJECT_ID`, `SCALLOP_MARKET_OBJECT_ID`, and optional `SCALLOP_VERSION_INITIAL_SHARED_VERSION` / `SCALLOP_MARKET_INITIAL_SHARED_VERSION` env vars once, alongside the existing `POLICY_ID`/`PACKAGE_ID` reads, and pass them through as `scallop` config. Unset means `scallop: undefined`.

## PTB Routing

### New builder (`actionflow/src/ptbBuilder.ts`)

```ts
export function buildScallopSupplySuiPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig,
  policyInitialSharedVersion?: string | number,
): Transaction
```

Calls `${packageId}::scallop_adapter::supply_sui` with: the policy shared-object ref, `action.amount`, the Walrus blob ID bytes, the Scallop version object, the Scallop market object (mutable), and the clock shared-object ref.

Object resolution follows the same optional-initial-version pattern `buildRecordActionPtb` already uses for the policy object: if `versionInitialSharedVersion`/`marketInitialSharedVersion` is provided, use `tx.sharedObjectRef(...)` (offline-buildable, no client round-trip); if omitted, use `tx.object(scallop.versionObjectId)` / `tx.object(scallop.marketObjectId)`, resolved online during `tx.build({ client })`. The clock keeps using the existing hardcoded `SUI_CLOCK_OBJECT_ID` / `SUI_CLOCK_INITIAL_SHARED_VERSION` constants.

### Routing function (`actionflow/src/ptbBuilder.ts`)

```ts
export type BuildActionPtbResult =
  | { ok: true; tx: Transaction }
  | { ok: false; status: 'config_missing'; reason: string }

export function buildActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig | undefined,
  policyInitialSharedVersion?: string | number,
): BuildActionPtbResult
```

If `action.protocol === 'scallop' && action.action === 'supply'`: requires `scallop` to be defined, else returns `{ ok: false, status: 'config_missing', reason: 'scallop config required for scallop supply' }`; otherwise returns `{ ok: true, tx: buildScallopSupplySuiPtb(...) }`.

Otherwise: returns `{ ok: true, tx: buildRecordActionPtb(...) }` unchanged.

This is the single place that implements the protocol/action → adapter decision. `translateAction` (ActionFlow, used by AgentRunner) and `runPolicyCycle` (PolicyLoop) both call `buildActionPtb` instead of `buildRecordActionPtb` directly, and propagate a `config_missing` result the same way they already propagate `validation_failed`.

`buildRecordActionPtb` and `buildScallopSupplySuiPtb` remain individually exported for direct/test use; `buildActionPtb` is the integration point.

## Event Parsing (`agentrunner/src/submitter.ts`, `types.ts`)

A successful Scallop supply transaction emits `::policy::ScallopSuiSupplied`, not `::policy::ActionRecorded`. Add:

```ts
export interface ScallopSuiSuppliedEvent {
  policyId: string
  agent: string
  amount: string
  spentTotal: string
  vaultBalance: string
  scallopPositionBalance: string
  walrusBlobId: string
  timestampMs: string
}
```

`RunActionResult`'s success case becomes a discriminated union:

```ts
export type RunActionResult =
  | { ok: true; status: 'succeeded'; digest: string; eventKind: 'action_recorded'; event: ActionRecordedEvent }
  | { ok: true; status: 'succeeded'; digest: string; eventKind: 'scallop_sui_supplied'; event: ScallopSuiSuppliedEvent }
  | { ok: false; status: 'validation_failed'; errors: FieldError[] }
  | { ok: false; status: 'config_missing'; reason: string }
  | { ok: false; status: 'simulation_failed'; reason: string }
  | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
  | { ok: false; status: 'event_missing'; digest: string }
  | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }
```

`submitTransaction` checks the emitted events for `::policy::ScallopSuiSupplied` first, then `::policy::ActionRecorded`, and returns the matching discriminated result. Neither found still returns `event_missing`.

`PolicyLoopResult` (policyloop) is `{ ok: true; status: 'skipped'; reason: string } | RunActionResult`, so it picks up the new variants without change.

## Error Handling

- Missing/null `action` in a parsed goal: existing field-error pattern (`{ field: 'action', reason: 'not specified in goal' }`), same as protocol/amount.
- Scallop + unsupported direction: validation error as above; never reaches PTB building.
- Scallop route selected but no `scallop` config supplied: `config_missing` result, surfaced before any chain call.
- All existing record_action error paths (validation, simulation, execution, event-missing, submission) are unchanged for the fallback route.

## Testing

- `extractor.test.ts`: `action` extracted when stated, `null` when not, alongside existing protocol/amount cases.
- `validator.test.ts`: scallop+supply passes (existing budget/limit cases extended with `action: 'supply'`), scallop+withdraw rejected, non-scallop protocol accepts either direction unchanged, missing `action` produces a field error.
- `ptbBuilder.test.ts`: `buildScallopSupplySuiPtb` produces a moveCall targeting `scallop_adapter::supply_sui` with the expected six arguments; `buildActionPtb` routes scallop+supply to the Scallop builder, routes everything else to `buildRecordActionPtb`, and returns `config_missing` when scallop config is absent for a scallop+supply action.
- `decision.test.ts`: `propose` decisions include `action: 'supply'`.
- `submitter.test.ts`: `ScallopSuiSupplied` event parsed into `eventKind: 'scallop_sui_supplied'`; existing `ActionRecorded` parsing unchanged; neither-event case still `event_missing`.
- `index.test.ts` (actionflow, agentrunner, policyloop): end-to-end translate/run/cycle paths updated for the new `action` field and exercising both the Scallop and fallback routes with mocked clients.

## Non-Goals

- Scallop redeem/withdraw on-chain support (Move side already excludes it; this phase only ensures the TS side rejects it cleanly).
- A DeepBook (or any other protocol) adapter.
- Real Walrus storage — `walrusBlobId` remains an opaque passthrough string.
- Mainnet publishing/deployment scripts for `nexus_agent_wallet` or Scallop object-ID discovery tooling — object IDs are supplied via configuration, sourced operationally.
- AI/LLM-driven decision making in PolicyLoop (still the fixed template, now declaring `action: 'supply'` explicitly).
