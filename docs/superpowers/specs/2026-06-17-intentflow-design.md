# IntentFlow Design

**Date:** 2026-06-17
**Status:** Approved
**Author:** Design session (brainstorming skill)

## Purpose

IntentFlow is Nexus's natural-language → structured-strategy → PTB translation layer (per `Nexus.md`). This design covers the **first version**: translating a plain-English **policy-setup goal** (e.g. "Let my agent trade on Scallop with a $500 budget, max $100 per trade, expiring in 30 days") into a structured strategy and a constructed (but unsigned, unsubmitted) Sui Programmable Transaction Block that calls `nexus_agent_wallet::policy::create_policy`.

## Scope

**In scope (v1):**
- Parsing policy-setup goals only — budget, per-transaction limit, allowed protocols, expiry.
- Extraction via the Claude API (model `claude-opus-4-8`), using structured outputs (`output_config.format`) for a strict JSON schema.
- Validating the extracted strategy against the same business rules `nexus_agent_wallet::policy::create_policy` enforces, before ever touching the chain.
- Building the PTB locally with `@mysten/sui` and returning its serialized bytes — no signing, no submission to any network.
- A TypeScript library (`intentflow/`) with a thin CLI wrapper for manual testing.

**Out of scope (future work, not designed here):**
- Action/execution goals (e.g. "deposit 100 USDC into Scallop" → `record_action`).
- Real external protocol integrations (Scallop, DeepBook, etc.) — `allowed_protocols` are free-text strings the user names; no real Move calls into those packages are built.
- Signing, wallet integration, zkLogin, or submitting any transaction to a live network.
- An HTTP API / server process.
- Multi-turn clarification when the goal is ambiguous or incomplete — incomplete input is a validation error, not a follow-up question.
- Auto-repairing or defaulting missing fields (e.g. inventing an expiry the user never stated).

## Architecture

```
NL goal (string)
   │
   ▼
┌─────────────────┐
│ 1. Extractor     │  Claude API call, output_config.format (strict JSON schema)
│   (extractor.ts) │  → raw PolicyStrategy fields (nullable where unstated)
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ 2. Validator     │  Pure functions, no I/O. Mirrors policy.move's own
│   (validator.ts) │  assertions. Returns Ok(strategy) or field-level errors.
└─────────────────┘
   │
   ▼
┌─────────────────┐
│ 3. PTB Builder   │  @mysten/sui Transaction — adds one moveCall to
│   (ptbBuilder.ts)│  nexus_agent_wallet::policy::create_policy.
└─────────────────┘  Returns the unsigned, serialized PTB.
   │
   ▼
translateGoal(goal) → { strategy, ptbBytes } | { errors }
```

No network calls beyond the Claude API request. No signing keypair is required — the PTB is built with `onlyTransactionKind` (no sender needed) since wallet/zkLogin integration doesn't exist yet.

## Components

### `extractor.ts`
- Exports `extractStrategy(goal: string): Promise<RawStrategy>`.
- One `client.messages.create()` call using `output_config: { format: { type: "json_schema", schema: POLICY_STRATEGY_SCHEMA } }`.
- System prompt explains the PolicyObject domain (budget, max single tx, allowed protocols, expiry) so Claude maps loose phrasing into the right fields, but does not invent unstated values — the schema marks fields nullable, and nulls become validator errors, not guesses.
- A `stop_reason: "refusal"` is treated as an extraction failure (see Error Handling).
- Returns raw, untrusted JSON — the validator is the only gate that matters.

### `validator.ts`
- Exports `validateStrategy(raw: RawStrategy): ValidationResult`, a discriminated union:
  `{ ok: true, strategy: PolicyStrategy } | { ok: false, errors: FieldError[] }`.
- Re-implements (in TypeScript, no on-chain call) the exact checks `policy.move::create_policy` enforces:
  - `max_total_budget > 0`
  - `0 < max_single_tx <= max_total_budget`
  - `allowed_protocols` non-empty
  - `expires_at_ms` strictly in the future
- Each failure names the field and reason (e.g. `max_single_tx (150) exceeds max_total_budget (100)`) so the CLI can print something actionable instead of waiting for an on-chain abort code.

### `ptbBuilder.ts`
- Exports `buildCreatePolicyPtb(strategy: PolicyStrategy, packageId: string): Transaction`.
- Uses `@mysten/sui/transactions` `Transaction.moveCall` targeting `${packageId}::policy::create_policy` with args in the exact order the Move function expects: agent, max_total_budget, max_single_tx, allowed_protocols, expires_at_ms, clock.
- `packageId` is supplied by the caller (env var / config) — the contract has not been published to any network yet, so this stays a placeholder.

### `index.ts`
- Exports `translateGoal(goal: string, opts: { packageId: string }): Promise<{ strategy, ptbBytes } | { errors }>` — composes the three stages above.

### `bin/intentflow.ts`
- CLI entry point: reads the goal from `process.argv`, calls `translateGoal`, pretty-prints the strategy (JSON) and PTB bytes (base64) on success, or the error list on failure (exit code 1).

## Data Flow & Error Handling

**Happy path:** goal → `extractStrategy` → `validateStrategy` → `buildCreatePolicyPtb` → `{ strategy, ptbBytes }`.

**Error paths** — every failure is a typed result; exceptions do not cross module boundaries except for genuine infra failures:

| Failure | Where caught | Surfaced as |
|---|---|---|
| Claude API error (network, rate limit, auth) | `extractStrategy` | Anthropic SDK typed error propagates to the CLI's top-level catch (infra failure, not user-input problem) |
| `stop_reason: "refusal"` | `extractStrategy` | `{ ok: false, errors: [{ field: "_root", reason: "could not parse goal" }] }` |
| Schema-valid JSON but missing/null required field | `validateStrategy` | `FieldError` naming the field, e.g. `{ field: "max_total_budget", reason: "not specified in goal" }` |
| Schema-valid JSON but business-rule violation | `validateStrategy` | `FieldError` with the offending values |
| Goal text unrelated to policy setup | `extractStrategy` returns all-null fields | Falls through to the same missing-field errors in `validateStrategy` |

The CLI's only job on failure is to print the `errors` array and exit 1. No retries, no auto-repair.

## Testing

- **`validator.test.ts`** — pure unit tests, no mocking. Covers every boundary the Move contract's own test suite covers conceptually: zero budget, single_tx > budget, single_tx == budget (boundary success), empty protocols, past expiry, all-fields-valid.
- **`ptbBuilder.test.ts`** — given a fixed valid `PolicyStrategy`, asserts the built `Transaction` contains exactly one `moveCall` with the right target and argument order/types. No network calls.
- **`extractor.test.ts`** — mocks `client.messages.create` (no real API calls in CI/tests) across representative goal strings, including a refusal case and an all-nulls case.
- **`index.test.ts`** — integration test composing real `validateStrategy`/`buildCreatePolicyPtb` with a mocked `extractStrategy`: one full happy path, one full rejected-at-validation path.

Test runner: `vitest` (fast, native ESM/TS, minimal config).

## Open Items for Future Versions (explicitly deferred)

- Action/execution goals and `record_action` PTB construction.
- Real protocol integrations beyond our own contract.
- Signing + submission once zkLogin/wallet integration exists.
- HTTP API surface, if/when a frontend needs to call IntentFlow directly.
