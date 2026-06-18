# AgentRunner Design

**Date:** 2026-06-18
**Status:** Approved
**Author:** Design session (brainstorming skill)

## Purpose

AgentRunner is Nexus's sign-and-submit layer: it takes the unsigned PTB bytes ActionFlow's `translateAction()` already validates and constructs, signs them as the policy's approved agent, simulates the result, and submits it to a live Sui network. This is exactly the deferred item ActionFlow's own design spec named ("Signing + submission once zkLogin/wallet integration exists") — closing the loop from "plain-English goal" to "real on-chain action," while keeping the boundary between *construct-only* (ActionFlow) and *can move real funds* (AgentRunner) explicit and isolated in separate packages.

## Scope

**In scope (v1):**
- A new standalone TypeScript package, `agentrunner/`, sibling to `actionflow/`, `intentflow/`, `nexus_agent_wallet/`, mirroring `actionflow/`'s package layout and tooling (package.json, tsconfig, vitest.config, `.gitignore`) exactly.
- End-to-end orchestration: `runAction()` calls ActionFlow's `translateAction()` directly (not just consuming pre-built PTB bytes) and carries the result through signing, simulation, and execution.
- Loading the agent's signing keypair from an environment variable (`AGENTRUNNER_PRIVATE_KEY`), using the standard `suiprivkey1...` bech32 format the Sui CLI (`sui keytool`) already exports — no custom key encoding.
- Dry-running (`dryRunTransactionBlock`) the fully-resolved transaction before submitting, to catch on-chain aborts (including `ENotAgent` — the agent-identity check ActionFlow itself cannot perform locally) without spending gas.
- Signing and executing (`signAndExecuteTransaction`) on a clean dry run, then parsing the resulting `ActionRecorded` event back into a typed result.
- A small internal retry-with-backoff for transient network/RPC failures only — never for on-chain abort content, since retrying can't change a Move assertion's outcome.
- A CLI (`agentrunner/bin/agentrunner.ts`), mirroring ActionFlow's CLI shape, requiring its own additional env var.

**Out of scope:**
- Real Scallop/DeepBook protocol calls — `record_action` is still on-chain bookkeeping only; no actual fund movement into a protocol exists yet.
- Real Walrus storage (still a caller-supplied placeholder, per ActionFlow's existing scope).
- zkLogin, frontend, or any non-CLI key provisioning. The env-var keypair is explicitly a backend-controlled, single-agent stopgap for this phase.
- Configurable/exposed retry policy (attempt count, backoff curve) — fixed internally until a real need for tuning appears.
- Monitoring or deciding *when* to act (the "Nexus monitors Sui DeFi opportunities" loop from the product vision) — AgentRunner only executes a single given goal on request.
- An HTTP API / server process.

## Architecture

```
NL action goal (string) + opts (policyId, packageId, walrusBlobId)
   │
   ▼
┌──────────────────────┐
│ 1. translateAction()    │  ActionFlow (existing, untouched) — extract → fetch
│   (actionflow package) │  live policy state → validate → build unsigned PTB
└──────────────────────┘  → { ok: true, action, ptbBytes } | { ok: false, errors }
   │
   ├─ not ok ───────────────────────────────────────────► validation_failed (passthrough)
   │
   ▼ ok
┌──────────────────────┐
│ 2. Signer               │  loadAgentKeypair() — Ed25519Keypair from
│   (signer.ts)          │  AGENTRUNNER_PRIVATE_KEY (suiprivkey1... format)
└──────────────────────┘
   │
   ▼
┌──────────────────────┐
│ 3. Reconstruct + sender │  Transaction.fromKind(ptbBytes); setSender(agent address)
└──────────────────────┘
   │
   ▼
┌──────────────────────┐
│ 4. Submitter            │  build full tx (resolves gas) → dryRunTransactionBlock
│   (submitter.ts)       │  → (clean) signAndExecuteTransaction → parse ActionRecorded
└──────────────────────┘
   │
   ▼
runAction(goal, opts) → RunActionResult (6-way discriminated union, see Components)
```

Key relationship to ActionFlow:
- ActionFlow is untouched. AgentRunner depends on it as a normal package dependency and calls `translateAction()` directly — it does not duplicate extraction, state-fetching, or validation logic.
- ActionFlow's own documented caveat — it has no signer, so it can't locally verify the eventual sender will equal `policy.agent` — is resolved here, but not by adding a redundant local address comparison. The dry-run step already executes the real `record_action` Move code, whose first assertion is `assert_agent`. A mismatched agent surfaces as a clean, no-cost `simulation_failed` (with the real Move abort reason) before anything is signed or submitted, which satisfies ActionFlow's deferred concern without new duplicated logic.
- AgentRunner is the one package in the system where a real, funded, real-world keypair is loaded and real transactions are submitted. Keeping it a separate package (rather than extending `actionflow/`) keeps that blast radius and its required secret visible from the file tree alone.

**Operational prerequisite (not a design decision, just a fact to document):** the agent's address (derived from `AGENTRUNNER_PRIVATE_KEY`) must hold enough SUI to pay gas, since `tx.build({ client })` resolves a real gas payment from the sender's owned coins.

## Components

### `src/types.ts`
```typescript
export interface ActionRecordedEvent {
  policyId: string
  agent: string
  protocolId: string
  amount: string       // u64 — string to avoid Number precision loss and BigInt's JSON.stringify incompatibility
  spentTotal: string    // u64, same reasoning
  walrusBlobId: string
  timestampMs: string   // u64, same reasoning
}

export type RunActionResult =
  | { ok: true; status: 'succeeded'; digest: string; event: ActionRecordedEvent }
  | { ok: false; status: 'validation_failed'; errors: FieldError[] }
  | { ok: false; status: 'simulation_failed'; reason: string }
  | { ok: false; status: 'execution_aborted'; digest: string; reason: string }
  | { ok: false; status: 'event_missing'; digest: string }
  | { ok: false; status: 'submission_failed'; stage: 'dry_run' | 'execute'; reason: string }

export interface RunActionOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  client?: Anthropic
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair   // override for tests; defaults to loadAgentKeypair()
}
```
`FieldError` is re-exported/reused from `actionflow` (no redefinition).

The six `RunActionResult` cases, and why each exists:
| status | Gas spent? | Digest exists? | Meaning |
|---|---|---|---|
| `succeeded` | yes | yes | Execution succeeded and the expected `ActionRecorded` event was found and parsed. |
| `validation_failed` | no | no | ActionFlow itself rejected the goal/action — passthrough of its `FieldError[]`. |
| `simulation_failed` | no | no | Dry-run caught an on-chain abort (e.g. `ENotAgent`, paused, budget) before submission. |
| `execution_aborted` | yes | yes | Rare race: dry-run was clean, but real execution still aborted on-chain (e.g. another action changed `spent_total` in between). |
| `event_missing` | yes | yes | Execution effects reported success, but no `ActionRecorded` event was found — treated as a real anomaly, not silently folded into `succeeded`. |
| `submission_failed` | maybe | no | A transport/RPC-level failure (not an on-chain result) survived retries; `stage` says whether it happened during dry-run or execute. |

### `src/signer.ts`
- Exports `loadAgentKeypair(): Ed25519Keypair`.
- Reads `process.env.AGENTRUNNER_PRIVATE_KEY`; throws a clear error (propagates as an exception — a setup/config failure, not a `RunActionResult` case) if missing.
- Decodes via `Ed25519Keypair.fromSecretKey(secret)`, which natively accepts the `suiprivkey1...` bech32 format.

### `src/submitter.ts`
- Exports `submitTransaction(tx: Transaction, signer: Ed25519Keypair, suiClient: SuiJsonRpcClient): Promise<RunActionResult>` — everything from "build the full transaction" onward.
- Internal retry helper wraps exactly two network calls: the dry-run RPC call and the execute RPC call. Each gets a small fixed number of attempts with backoff, retrying only on transport-level errors (the call itself throwing/rejecting due to network issues) — never because of the *content* of a successful response.
- Dry-run: build full tx bytes (`tx.build({ client: suiClient })`), call `dryRunTransactionBlock`. Response with `effects.status.status === 'failure'` → `simulation_failed` immediately (no retry). Otherwise proceed.
- Execute: `signAndExecuteTransaction({ transaction: builtBytes, signer, options: { showEffects: true, showEvents: true } })`. Response with `effects.status.status === 'failure'` → `execution_aborted` with `digest` + the effects' error string. Response with `'success'` → search `response.events` for an entry whose `type` ends with `::policy::ActionRecorded`; found → decode its `parsedJson` fields into `ActionRecordedEvent` and return `succeeded`; not found → `event_missing`.

### `src/index.ts`
- Exports `runAction(goal: string, opts: RunActionOptions): Promise<RunActionResult>`.
- Calls `translateAction(goal, opts)` (from `actionflow`). Not ok → `{ ok: false, status: 'validation_failed', errors }`.
- Else: `const signer = opts.signer ?? loadAgentKeypair()`; `const tx = Transaction.fromKind(result.ptbBytes)`; `tx.setSender(signer.toSuiAddress())`; delegate to `submitTransaction(tx, signer, suiClient)`.

### `bin/agentrunner.ts`
- CLI entry point, same shape as ActionFlow's: reads the goal from `process.argv`, checks all required env vars up front (ActionFlow's three, plus `AGENTRUNNER_PRIVATE_KEY`) and exits 1 with a message if any are missing — before any API/network call. Calls `runAction`, then prints based on `result.status`: pretty-printed `event` + `digest` on `succeeded`; the relevant fields (`errors`, `reason`, `digest` where present) on every failure case; exits 1 on any non-`succeeded` outcome.

## Data Flow & Error Handling

**Happy path:** goal + opts → `translateAction` → `loadAgentKeypair` → `Transaction.fromKind` + `setSender` → dry-run (clean) → execute (success + event found) → `succeeded`.

**Error paths:**

| Failure | Where caught | Surfaced as |
|---|---|---|
| Missing `AGENTRUNNER_PRIVATE_KEY` | `loadAgentKeypair` | Thrown exception (config error, checked by the CLI before any call) |
| ActionFlow validation failure (any of its own documented cases) | `translateAction` | `{ status: 'validation_failed', errors }` |
| Dry-run RPC/network failure, retries exhausted | `submitTransaction` | `{ status: 'submission_failed', stage: 'dry_run', reason }` |
| Dry-run succeeds, on-chain abort (`ENotAgent`, `EPolicyPaused`, `EPolicyRevoked`, expired, protocol not allowed, budget exceeded, stale-state race) | `submitTransaction` | `{ status: 'simulation_failed', reason }` |
| Execute RPC/network failure, retries exhausted | `submitTransaction` | `{ status: 'submission_failed', stage: 'execute', reason }` |
| Execute succeeds at the RPC level but effects report on-chain failure | `submitTransaction` | `{ status: 'execution_aborted', digest, reason }` |
| Execute succeeds, effects report success, but no `ActionRecorded` event found | `submitTransaction` | `{ status: 'event_missing', digest }` |

The CLI's job on any non-`succeeded` result is to print the relevant fields and exit 1. No auto-retry beyond `submitTransaction`'s internal transport-level retries; no auto-repair.

## Testing

- **`signer.test.ts`** — `loadAgentKeypair()` throws a clear error when `AGENTRUNNER_PRIVATE_KEY` is unset; correctly decodes a real generated test keypair's exported secret key when set.
- **`submitter.test.ts`** — mocks `SuiJsonRpcClient.dryRunTransactionBlock` / `signAndExecuteTransaction` (no real RPC calls): clean dry-run + successful execute + matching event → `succeeded` with correctly parsed fields; dry-run effects failure → `simulation_failed`, no execute call made; dry-run RPC throwing repeatedly → `submission_failed` with `stage: 'dry_run'`; execute RPC throwing repeatedly → `submission_failed` with `stage: 'execute'`; execute effects failure → `execution_aborted` with digest; execute success but no matching event in `response.events` → `event_missing` with digest.
- **`index.test.ts`** — mocks `actionflow`'s `translateAction` and `submitTransaction`: validation failure passthrough (submitter never called); happy path composes correctly (signer loaded, `Transaction.fromKind` + `setSender` called with the right address, result passed through from the submitter).
- Test runner: `vitest`, same config style as ActionFlow/IntentFlow. No real network calls or real keypairs with real funds in any test.

## Open Items for Future Versions (explicitly deferred)

- Configurable retry policy, if a real need for tuning (e.g. exponential vs. fixed backoff, attempt count) emerges in production.
- Multi-agent / multi-key support (currently one backend-controlled keypair via one env var).
- Real key provisioning via zkLogin or a secrets manager, once the frontend/auth layer exists.
- The monitoring/decision loop that decides *when* to call `runAction` for a given policy (currently a manual, on-request CLI call per goal).
