# ActionFlow Design

**Date:** 2026-06-18
**Status:** Approved
**Author:** Design session (brainstorming skill)

## Purpose

ActionFlow is Nexus's natural-language → structured-action → PTB translation layer for **action/execution goals**, the piece IntentFlow's own design explicitly deferred (`docs/superpowers/specs/2026-06-17-intentflow-design.md`, "Out of scope"). This design covers translating a plain-English action goal (e.g. "deposit $100 into Scallop, yield looks better there") into a structured action and a constructed (but unsigned, unsubmitted) Sui Programmable Transaction Block that calls `nexus_agent_wallet::policy::record_action`.

## Scope

**In scope (v1):**
- Parsing action goals via Claude (protocol + amount extraction) — same structured-output pattern as IntentFlow.
- Fetching the live `PolicyObject` from chain (via `SuiClient`) to get current `spent_total`, `paused`, `revoked`, `expires_at_ms`, `allowed_protocols`, `agent`, `max_single_tx`, `max_total_budget`.
- Validating the extracted action against that live state, replicating `record_action`'s on-chain assertions (except the agent-identity check — see Architecture caveat), before ever building a PTB.
- Building the `record_action` PTB locally and returning its serialized bytes — no signing, no submission.
- Caller supplies the `walrusBlobId` as an opaque placeholder string — Walrus integration is a separate, not-yet-built subsystem.
- A new standalone TypeScript package, `actionflow/`, sibling to `intentflow/` and `nexus_agent_wallet/`.

**Out of scope:**
- Real Scallop/DeepBook protocol calls — `record_action` is still just on-chain bookkeeping; no actual fund movement exists yet.
- Real Walrus storage.
- Signing, wallet integration, zkLogin, or submitting any transaction to a live network.
- An HTTP API / server process.
- Multi-turn clarification when the goal is ambiguous or incomplete — incomplete input is a validation error, not a follow-up question.
- Auto-repairing or defaulting missing fields.

## Architecture

```
NL action goal (string) + policyId (string)
   │
   ▼
┌─────────────────────┐
│ 1. Extractor          │  Claude API call, structured JSON schema output
│   (extractor.ts)      │  → raw ActionGoal fields (nullable where unstated)
└─────────────────────┘
   │
   ▼
┌─────────────────────┐
│ 2. State Fetcher       │  SuiClient.getObject({ id: policyId, showContent: true })
│   (policyState.ts)    │  → live PolicyObject fields (spent_total, paused, revoked,
└─────────────────────┘     expires_at_ms, allowed_protocols, agent, max_single_tx,
   │                         max_total_budget)
   ▼
┌─────────────────────┐
│ 3. Validator           │  Pure function given (raw goal, live state, nowMs).
│   (validator.ts)      │  Mirrors record_action's assertion order.
└─────────────────────┘  Returns Ok(action) or field-level errors.
   │
   ▼
┌─────────────────────┐
│ 4. PTB Builder         │  @mysten/sui Transaction — one moveCall to
│   (ptbBuilder.ts)     │  nexus_agent_wallet::policy::record_action.
└─────────────────────┘  Returns the unsigned, serialized PTB.
   │
   ▼
translateAction(goal, opts) → { action, ptbBytes } | { errors }
```

Key differences from IntentFlow's pipeline:
- One extra stage (State Fetcher) sits between extraction and validation — the only stage besides the Claude call that touches the network, since this subsystem validates against live on-chain truth rather than constructing a brand-new object offline.
- The validator takes live state as an input, not just the parsed goal — `record_action`'s checks (`paused`, `revoked`, `expires_at_ms`, `allowed_protocols`, `spent_total + amount <= max_total_budget`, etc.) are all checked against current on-chain state at call time.
- **Caveat — agent-identity check is chain-only.** `record_action`'s first on-chain assertion is `assert_agent` (sender must equal `policy.agent`). ActionFlow has no signer/keypair (same as IntentFlow), so it cannot check "is the caller the agent" locally. Every other rule it replicates faithfully. This means a successful ActionFlow validation does **not** guarantee the eventual on-chain submission will succeed — if submitted by the wrong address, it will still abort with `ENotAgent` on-chain despite passing here. This is intentional and must be stated plainly in output/docs so nobody mistakes "validated" for "guaranteed to succeed."

## Components

### `extractor.ts`
- Exports `extractActionGoal(goal: string, client: Anthropic): Promise<RawActionGoal>` — same structured-output pattern as IntentFlow's extractor (`output_config.format` with a strict JSON schema), reusing the same refusal-handling convention (`ExtractionRefusedError`).
- `RawActionGoal` fields (all nullable — null means "not stated in the goal"):
  - `protocol: string | null` — free-text protocol label (e.g. `"scallop"`), matching IntentFlow's `allowedProtocols` convention — no real protocol registry, just the label the contract uses.
  - `amount: number | null` — the action amount, same units as the policy's budget fields (u64, no decimals/currency conversion).
- System prompt explains the action domain (deposit/withdraw/swap-style goals against a named protocol with an amount) so Claude maps phrasing like "put $100 into Scallop" into `{ protocol: "scallop", amount: 100 }`, without inventing unstated values.
- A `stop_reason: "refusal"` is treated as extraction failure, same as IntentFlow.

### `policyState.ts`
- Exports `fetchPolicyState(policyId: string, client: SuiClient): Promise<PolicyState>`.
- Calls `client.getObject({ id: policyId, options: { showContent: true } })`.
- Parses the Move struct's fields out of the response into a typed `PolicyState`:
  ```typescript
  interface PolicyState {
    agent: string
    maxTotalBudget: number
    spentTotal: number
    maxSingleTx: number
    allowedProtocols: string[]   // decoded from on-chain vector<vector<u8>> back to UTF-8 strings
    expiresAtMs: number
    paused: boolean
    revoked: boolean
  }
  ```
- If the object doesn't exist, isn't a `PolicyObject`, or the response shape doesn't match what's expected, throws a typed `PolicyFetchError` — an infra-style failure (bad policy ID, network issue), handled like IntentFlow treats Claude API errors: propagate to the caller's top-level catch rather than becoming a `FieldError`.
- Exact field decoding (how the installed `@mysten/sui` SDK represents `vector<vector<u8>>` and `u64` in the JSON response) is verified against the installed SDK's types during implementation/review, same as IntentFlow's PTB builder did for its own SDK calls.

### `validator.ts`
- Exports `validateAction(raw: RawActionGoal, state: PolicyState, nowMs: number): ValidationResult`, a discriminated union: `{ ok: true, action: PolicyAction } | { ok: false, errors: FieldError[] }`.
- `nowMs` threaded in explicitly by the caller, same rationale as IntentFlow (pure, deterministic, one consistent "now").
- First checks `protocol` and `amount` are non-null (null → `FieldError`, e.g. `{ field: "amount", reason: "not specified in goal" }`).
- Then re-implements `record_action`'s checks against `state`, in the same order as the Move contract (everything except `assert_agent`, per the Architecture caveat):
  - `!state.paused`
  - `!state.revoked`
  - `nowMs <= state.expiresAtMs`
  - `state.allowedProtocols.includes(raw.protocol)`
  - `amount > 0`
  - `amount <= state.maxSingleTx`
  - `state.spentTotal + amount <= state.maxTotalBudget`
- Each failure names the field/condition and the actual values involved (e.g. `{ field: "amount", reason: "spentTotal (450) + amount (100) exceeds maxTotalBudget (500)" }`).
- Output `PolicyAction` carries everything `ptbBuilder.ts` needs: `{ policyId, protocol, amount }`.

### `ptbBuilder.ts`
- Exports `buildRecordActionPtb(action: PolicyAction, walrusBlobId: string, packageId: string): Transaction`.
- Uses `Transaction.moveCall` targeting `${packageId}::policy::record_action` with args in the exact order the Move function expects: `policy` (object ref, mutable shared object — `tx.object(action.policyId)`), `protocol_id` (bytes), `amount` (u64), `walrus_blob_id` (bytes, from the caller-supplied placeholder string), `clock` (shared object ref, same `0x6` convention as IntentFlow's builder).
- `walrusBlobId` is passed in by the caller per the earlier decision — this library never generates or validates it, just encodes whatever string it's given.

### `index.ts`
- Exports `translateAction(goal: string, opts: { policyId: string, packageId: string, client?: Anthropic, suiClient?: SuiClient, walrusBlobId: string }): Promise<TranslateActionResult>` — composes extractor → state fetcher → validator → PTB builder, mirroring IntentFlow's `translateGoal` composition.

### `bin/actionflow.ts`
- CLI entry point, same shape as IntentFlow's: reads the goal from `process.argv`, required env vars (`ACTIONFLOW_PACKAGE_ID`, plus a policy ID and Walrus blob ID — exact arg/env split finalized in the implementation plan), calls `translateAction`, pretty-prints the action (JSON) and PTB bytes (base64) on success, or the error list on failure (exit 1).

## Data Flow & Error Handling

**Happy path:** goal + policyId → `extractActionGoal` → `fetchPolicyState` → `validateAction(raw, state, Date.now())` → `buildRecordActionPtb` → `{ action, ptbBytes }`.

**Error paths** — every user-input failure is a typed result; genuine infra failures propagate as exceptions to the caller's top-level catch, same convention as IntentFlow:

| Failure | Where caught | Surfaced as |
|---|---|---|
| Claude API error (network, rate limit, auth) | `extractActionGoal` | Anthropic SDK typed error propagates (infra failure) |
| `stop_reason: "refusal"` | `extractActionGoal` | `{ ok: false, errors: [{ field: "_root", reason: "could not parse goal" }] }` |
| Goal text unrelated to an action (all-null fields) | `extractActionGoal` returns nulls | Falls through to missing-field errors in `validateAction` |
| Policy object doesn't exist / wrong type / RPC error | `fetchPolicyState` | `PolicyFetchError` propagates (infra failure, not a `FieldError`) |
| Schema-valid JSON but missing/null `protocol` or `amount` | `validateAction` | `FieldError` naming the field |
| Business-rule violation (paused, revoked, expired, protocol not allowed, amount ≤ 0, exceeds single-tx limit, exceeds remaining budget) | `validateAction` | `FieldError` with the offending values, mirroring `record_action`'s own abort conditions |

The CLI's only job on failure is to print the `errors` array (or, for thrown infra errors, the error message) and exit 1. No retries, no auto-repair.

## Testing

- **`validator.test.ts`** — pure unit tests, no mocking, fixed `nowMs` and a fixed `PolicyState` fixture. Covers every `record_action` boundary: paused, revoked, expired (`nowMs > expiresAtMs`), protocol not in `allowedProtocols`, `amount` null, `amount <= 0`, `amount > maxSingleTx` (boundary: equal succeeds), `spentTotal + amount > maxTotalBudget` (boundary: equal succeeds), all-valid happy path.
- **`policyState.test.ts`** — mocks `SuiClient.getObject` (no real RPC calls in tests): a well-formed response parses into the expected `PolicyState`; a missing/malformed object throws `PolicyFetchError`.
- **`ptbBuilder.test.ts`** — given a fixed `PolicyAction` and `walrusBlobId`, asserts the built `Transaction` contains exactly one `moveCall` with the right target and argument order/types. No network calls.
- **`extractor.test.ts`** — mocks `client.messages.create` across representative goal strings, including a refusal case and an all-nulls case.
- **`index.test.ts`** — integration test composing real `validateAction`/`buildRecordActionPtb` with mocked `extractActionGoal` and `fetchPolicyState`: one full happy path, one validation-rejected path (e.g. amount exceeds remaining budget), one infra-failure path (state fetch throws).

Test runner: `vitest`, same config style as IntentFlow.

## Open Items for Future Versions (explicitly deferred)

- Real protocol integrations (Scallop, DeepBook).
- Signing + submission once zkLogin/wallet integration exists — including, at that point, surfacing the agent-identity mismatch case as a pre-submission check rather than relying solely on the on-chain abort.
- Real Walrus blob ID generation/validation (currently caller-supplied placeholder).
- HTTP API surface, if/when a frontend needs to call ActionFlow directly.
