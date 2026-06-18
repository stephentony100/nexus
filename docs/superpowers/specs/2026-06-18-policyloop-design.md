# PolicyLoop Design Spec

## Purpose

Closes the deferred "monitoring/decision loop" item from AgentRunner's design spec: today, `runAction(goal, opts)` only ever executes once a human types a plain-English goal into the CLI. PolicyLoop adds the missing layer that decides *when* and *what* action to take for a given policy, without a human in the loop, so the agent can actually run autonomously on a schedule.

## Scope

**In scope (v1):**
- A new package, `policyloop/`, sibling to `actionflow/`, `agentrunner/`, `intentflow/`.
- A pure decision function that looks at a policy's live on-chain state and decides: skip this cycle, or propose a `{protocol, amount}` action.
- A fixed, deterministic decision template — no real DeFi market data, no AI reasoning about strategy. Always proposes a deposit into the policy's first allowed protocol, for the largest amount the remaining budget and per-transaction limit allow.
- Orchestration that re-validates the proposal, builds the PTB, signs it, and submits it — reusing ActionFlow's and AgentRunner's already-exported functions directly, with zero changes to either package.
- A CLI that runs exactly one decision cycle and exits. No daemon, no internal scheduling — an external scheduler (cron, hosted cron, etc.) is responsible for invoking it repeatedly. This stays consistent with the existing CLI-only, no-frontend state of the rest of Nexus.

**Out of scope (v1):**
- Real DeFi opportunity data (protocol yields, prices) influencing the decision.
- AI/LLM reasoning in the decision step (the decision is a fixed template, not a Claude call).
- Multi-policy monitoring in one process (one policy per invocation, via env var, matching AgentRunner's CLI convention).
- A long-running daemon process or any internal interval/sleep logic.
- Persisted state across cycles. Each cycle is stateless and re-derives everything it needs from the policy's live on-chain state (`spentTotal`, `paused`, `revoked`, `expiresAtMs`) — there is no "last action timestamp" tracked off-chain.
- Any changes to `actionflow/` or `agentrunner/`. Both packages already export everything PolicyLoop needs (`fetchPolicyState`, `validateAction`, `buildRecordActionPtb` from ActionFlow; `loadAgentKeypair`, `submitTransaction` from AgentRunner).

## Architecture

PolicyLoop is a thin orchestration layer, not a place to duplicate ActionFlow's or AgentRunner's logic. One cycle flows as:

```
fetch live policy state (ActionFlow: fetchPolicyState)
  -> decide whether to act (PolicyLoop's own decidePolicyAction)
  -> [if skip: return early]
  -> validate the proposed action (ActionFlow: validateAction)
  -> build the PTB (ActionFlow: buildRecordActionPtb -> Transaction)
  -> load the signer (AgentRunner: loadAgentKeypair)
  -> set the sender on the Transaction
  -> submit (AgentRunner: submitTransaction)
```

Because `buildRecordActionPtb` already returns a `Transaction` object (not bytes), and `submitTransaction` already accepts a `Transaction` directly, there is no base64-encode/decode round-trip anywhere in this flow — PolicyLoop passes the same `Transaction` object straight from ActionFlow's builder into AgentRunner's submitter.

The on-chain `record_action` call in `nexus_agent_wallet::policy` remains the final authority regardless of what the decision function or local re-validation conclude (paused/revoked/expired/budget/protocol checks are all re-asserted on-chain) — identical to how ActionFlow and AgentRunner already rely on it today. A second `fetchPolicyState` call between validation and submission is deliberately not added: the window between fetch and submit is the same one-shot-process window AgentRunner's own `runAction` already has, and any real race is still caught by the Move contract's own asserts at dry-run/execute time, surfacing as `simulation_failed`/`execution_aborted`.

## Components & Interfaces

### `policyloop/src/decision.ts`

The only genuinely new logic in this package — a pure function with no I/O:

```typescript
import type { PolicyState } from 'actionflow'

export type PolicyDecision =
  | { kind: 'skip'; reason: string }
  | { kind: 'propose'; protocol: string; amount: number }

export function decidePolicyAction(state: PolicyState, nowMs: number): PolicyDecision
```

Checks in order, mirroring `validateAction`'s own ordering:
1. `state.paused` → skip, reason `"policy is paused"`.
2. `state.revoked` → skip, reason `"policy is revoked"`.
3. `nowMs > state.expiresAtMs` → skip, reason `"policy expired at <expiresAtMs>"`.
4. `state.spentTotal >= state.maxTotalBudget` → skip, reason `"budget exhausted"`.
5. Otherwise → propose `{protocol: state.allowedProtocols[0], amount: Math.min(state.maxTotalBudget - state.spentTotal, state.maxSingleTx)}`.

`protocol`/`amount` match ActionFlow's existing `PolicyAction`/`RawActionGoal` convention (`protocol: string`, `amount: number`) — these are policy-level budget numbers already represented as `number` throughout ActionFlow, not raw on-chain u64 event values, so they don't carry the float-precision risk that motivated `string` typing in AgentRunner's `ActionRecordedEvent`.

### `policyloop/src/index.ts`

```typescript
import type { SuiJsonRpcClient } from '@mysten/sui/jsonRpc'
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { RunActionResult } from 'agentrunner'

export interface PolicyLoopOptions {
  policyId: string
  packageId: string
  walrusBlobId: string
  suiClient?: SuiJsonRpcClient
  signer?: Ed25519Keypair
}

export type PolicyLoopResult =
  | { ok: true; status: 'skipped'; reason: string }
  | RunActionResult

export async function runPolicyCycle(opts: PolicyLoopOptions): Promise<PolicyLoopResult>
```

`runPolicyCycle` composes, in order: `fetchPolicyState(opts.policyId, suiClient)` → `decidePolicyAction(state, Date.now())` → if `skip`, return `{ok: true, status: 'skipped', reason}` immediately, without calling `validateAction`, building anything, or touching the signer → if `propose`, call `validateAction({protocol, amount}, state, Date.now(), opts.policyId)` (note: `validateAction` takes a `RawActionGoal`-shaped object; `{protocol, amount}` from a `propose` decision satisfies that shape directly) → if invalid, return `{ok: false, status: 'validation_failed', errors}` → `buildRecordActionPtb(validated.action, opts.walrusBlobId, opts.packageId)` → `loadAgentKeypair()` if `opts.signer` not given → `tx.setSender(signer.toSuiAddress())` → `submitTransaction(tx, signer, suiClient)`, returning its result as-is.

### `policyloop/bin/policyloop.ts`

Reuses AgentRunner's exact env var names: `ACTIONFLOW_POLICY_ID`, `ACTIONFLOW_PACKAGE_ID`, `ACTIONFLOW_WALRUS_BLOB_ID`, `AGENTRUNNER_PRIVATE_KEY`. Runs exactly one cycle via `runPolicyCycle`, prints the result, exits 0 for `succeeded`/`skipped`, exits 1 for any other status. No goal argument (unlike AgentRunner's CLI) — there is nothing for a human to type.

## Data Flow & Error Handling

| Stage | Outcome | `PolicyLoopResult` |
|---|---|---|
| Decision | Policy paused / revoked / expired / budget exhausted | `{ok: true, status: 'skipped', reason}` |
| Decision → propose, re-validate | Validation fails (defense-in-depth; same snapshot used for decision and validation, so this is expected to be rare) | `{ok: false, status: 'validation_failed', errors}` |
| Build → dry-run | On-chain rule would abort (e.g. a real race: policy paused between fetch and submit) | `{ok: false, status: 'simulation_failed', reason}` |
| Execute | Effects report failure | `{ok: false, status: 'execution_aborted', digest, reason}` |
| Execute | Success but no `ActionRecorded` event | `{ok: false, status: 'event_missing', digest}` |
| Dry-run / execute | Transport error, retries exhausted | `{ok: false, status: 'submission_failed', stage, reason}` |
| Execute | Success | `{ok: true, status: 'succeeded', digest, event}` |

## Testing

- `decision.test.ts` — the bulk of real coverage: paused, revoked, expired, budget-exhausted, normal-propose (verifies it picks `allowedProtocols[0]` and `amount = min(remaining, maxSingleTx)`), and the boundary case where remaining budget is less than `maxSingleTx`.
- `index.test.ts` — mocks `actionflow`'s and `agentrunner`'s named exports (same `vi.mock` pattern AgentRunner's own `index.test.ts` already uses for `actionflow`), verifying: the skip case short-circuits before any validation/build/signing call; the happy-path wiring sets the sender correctly and passes the right arguments through to `submitTransaction`.
- CLI — manually verified (no automated test), matching AgentRunner's CLI convention.

## Open Items for Future Versions (explicitly deferred)

- Real DeFi data informing the decision (yields, prices, risk signals) instead of a fixed template.
- AI/LLM reasoning in the decision step.
- Multi-policy monitoring in a single process/config file.
- A long-running daemon with its own internal scheduling, if a real deployment ends up wanting one process per fleet rather than per-cycle external invocation.
- Any cross-cycle persisted state, if a future decision strategy needs to remember something not already captured in the policy's on-chain fields.
