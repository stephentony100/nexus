# Nexus AgentWallet Custody Vault Design

## Source Of Truth

This design follows `Nexus.md` and builds directly on `docs/superpowers/specs/2026-06-12-agent-wallet-policy-design.md`. That spec explicitly listed "custody vaults that hold user funds" under Later Extensions and "Holding user funds in the policy object" under Non-Goals — this is that extension.

## Scope

"Real DeFi integration" (the next major phase after PolicyLoop) splits into two sub-phases because the protocol adapter depends on the policy being able to custody funds first:

- **Phase 1 (this spec): Custody Vault.** Give `PolicyObject` the ability to hold real SUI, funded by the owner at creation, withdrawable by the owner at any time, with a read-only balance query. No agent-facing fund movement yet.
- **Phase 2 (future, separate spec): Protocol Adapter.** Once custody exists, design agent-facing fund movement together with the real Scallop/DeepBook call and budget enforcement, as one atomic, safe operation.

## Goals

- Let the owner fund a policy with a fixed amount of SUI at creation time, denominated identically to the policy's `max_total_budget`.
- Let only the owner withdraw some or all of the vault's remaining balance, at any time, regardless of the policy's paused/revoked/expired state.
- Expose a read-only balance query so off-chain code (and future on-chain logic) can see how much SUI a policy currently custodies.
- Leave `record_action` and all existing entry functions byte-for-byte unchanged — this phase adds custody, not action accounting or protocol execution.

## Non-Goals

- Any agent-facing withdrawal or fund-movement function. Investigation during design surfaced a real safety gap: a withdrawal function that doesn't debit `spent_total` lets the agent drain the vault across repeated calls without the on-chain budget ever reflecting it. Closing that gap correctly requires designing fund-extraction and budget-debiting as one atomic operation together with the real protocol call — that's Phase 2's job, not this one.
- Multiple coin types per policy. `PolicyObject` stays non-generic; the vault is fixed to `Balance<SUI>` for every policy. Generic `PolicyObject<T>` support, if ever needed, is a later phase.
- Top-up deposits after policy creation. The vault is funded once, at `create_policy` time, and never replenished in this phase.
- Real Scallop/DeepBook protocol calls. Still bookkeeping/custody only — no external protocol package is touched.

## Data Model

`PolicyObject` gains one field:

- `vault: Balance<SUI>`

All other existing fields (`id`, `owner`, `agent`, `max_total_budget`, `spent_total`, `max_single_tx`, `allowed_protocols`, `expires_at_ms`, `paused`, `revoked`, `created_at_ms`) are unchanged.

**Invariant:** at creation, `balance::value(&policy.vault) == policy.max_total_budget`. This is enforced by `create_policy`'s new validation (below) and never re-checked afterward — `owner_withdraw` can freely reduce the vault below `max_total_budget` since that's the owner reclaiming their own funds, not a budget violation.

## Public API

### `create_policy` (modified)

```move
public entry fun create_policy(
    agent: address,
    max_total_budget: u64,
    max_single_tx: u64,
    allowed_protocols: vector<vector<u8>>,
    expires_at_ms: u64,
    initial_deposit: Coin<SUI>,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

The new `initial_deposit` parameter is inserted after `expires_at_ms` and before `clock`.

New validation (in addition to all existing checks — budget > 0, single-tx limit > 0 and ≤ budget, protocol list non-empty, expiry in the future):

- `assert!(coin::value(&initial_deposit) == max_total_budget, EDepositMismatch)`

Effects (in addition to existing effects): `initial_deposit` is converted to `Balance<SUI>` via `coin::into_balance` and stored as `policy.vault`. `PolicyCreated` event is unchanged — the deposit amount is redundant with `max_total_budget`, which the event already carries.

### `owner_withdraw` (new)

```move
public entry fun owner_withdraw(
    policy: &mut PolicyObject,
    amount: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Validation:

- caller must be `owner` (reuses `assert_owner`) → `ENotOwner`
- `amount > 0` → `EZeroAmount` (reused from existing code)
- `amount <= balance::value(&policy.vault)` → `EInsufficientVaultBalance` (new)

No paused, revoked, or expiry checks — the owner can always reclaim their own funds regardless of the agent's permission state.

Effects: splits `amount` out of `policy.vault` via `balance::split`, converts it to `Coin<SUI>` via `coin::from_balance`, transfers it to `tx_context::sender(ctx)`, emits `FundsWithdrawn`.

### `vault_balance` (new, read-only)

```move
public fun vault_balance(policy: &PolicyObject): u64 { balance::value(&policy.vault) }
```

### Unchanged

`pause_policy`, `resume_policy`, `revoke_policy`, `record_action`, and every existing read-only accessor (`owner`, `agent`, `max_total_budget`, `spent_total`, `max_single_tx`, `expires_at_ms`, `paused`, `revoked`, `created_at_ms`, `allowed_protocol_count`, `is_protocol_allowed`) are untouched.

## Events

### `FundsWithdrawn` (new)

Fields:

- `policy_id: address`
- `owner: address`
- `amount: u64`
- `remaining_balance: u64`
- `timestamp_ms: u64`

### Unchanged

`PolicyCreated`, `PolicyPaused`, `PolicyResumed`, `PolicyRevoked`, `ActionRecorded` are untouched.

## Error Handling

New abort codes:

- `EDepositMismatch` — `create_policy`'s `initial_deposit` value does not equal `max_total_budget`.
- `EInsufficientVaultBalance` — `owner_withdraw`'s requested amount exceeds the current vault balance.

Reused abort codes:

- `ENotOwner` — `owner_withdraw` called by a non-owner.
- `EZeroAmount` — `owner_withdraw` called with `amount == 0`.

All existing abort codes (`EInvalidBudget`, `EInvalidSingleTxLimit`, `EEmptyProtocolList`, `EInvalidExpiry`, `ENotAgent`, `EPolicyPaused`, `EPolicyRevoked`, `EPolicyExpired`, `EProtocolNotAllowed`, `ESingleTxLimitExceeded`, `ETotalBudgetExceeded`) are untouched.

## Testing

Move tests (`nexus_agent_wallet/tests/policy_tests.move`) — new cases:

- `create_policy` succeeds when `initial_deposit`'s value equals `max_total_budget`.
- `create_policy` aborts with `EDepositMismatch` when deposit is less than `max_total_budget`.
- `create_policy` aborts with `EDepositMismatch` when deposit is more than `max_total_budget`.
- `vault_balance` returns the deposited amount immediately after creation.
- Owner can `owner_withdraw` a partial amount; `vault_balance` reflects the reduced balance; the withdrawn `Coin<SUI>`'s value matches the requested amount.
- Owner can `owner_withdraw` the full remaining balance down to zero.
- `owner_withdraw` aborts with `EZeroAmount` when amount is 0.
- `owner_withdraw` aborts with `EInsufficientVaultBalance` when amount exceeds the current balance.
- Non-owner calling `owner_withdraw` aborts with `ENotOwner`.
- `owner_withdraw` succeeds even when the policy is paused.
- `owner_withdraw` succeeds even when the policy is revoked.
- `owner_withdraw` succeeds even when the policy is expired.
- The full existing test suite (all current `record_action`/`pause_policy`/`resume_policy`/`revoke_policy` tests) still passes unmodified, confirming zero regression.

`destroy_for_testing` must be updated to explicitly consume `policy.vault` (e.g. via `balance::destroy_for_testing(vault)`), since `Balance<T>` has no `drop` ability and must be handled explicitly when destructuring the struct.

## TypeScript Impact

**`intentflow` (only package touched):**

`intentflow/src/ptbBuilder.ts`'s `buildCreatePolicyPtb` must add the new `initial_deposit` argument to the `create_policy` moveCall, in the exact position matching the new Move signature — after `expires_at_ms`, before `clock`:

```ts
tx.moveCall({
  target: `${packageId}::policy::create_policy`,
  arguments: [
    tx.pure.address(strategy.agentAddress),
    tx.pure.u64(strategy.maxTotalBudget),
    tx.pure.u64(strategy.maxSingleTx),
    tx.pure.vector('vector<u8>', allowedProtocolsBytes),
    tx.pure.u64(strategy.expiresAtMs),
    tx.splitCoins(tx.gas, [tx.pure.u64(strategy.maxTotalBudget)])[0],
    tx.sharedObjectRef({
      objectId: SUI_CLOCK_OBJECT_ID,
      initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
      mutable: false,
    }),
  ],
})
```

No changes to `intentflow/src/types.ts`, `extractor.ts`, or `validator.ts` — `PolicyStrategy`'s shape is unchanged, since the deposit amount is just `maxTotalBudget` again, not new user-facing input.

**Zero changes:** `actionflow`, `agentrunner`, `policyloop` are untouched — none of them call `create_policy` or any new Phase 1 function.

## Later Extensions (Phase 2 and beyond)

- Agent-facing fund movement, designed atomically with budget debiting and the real protocol call.
- Real Scallop/DeepBook adapters.
- Generic `PolicyObject<T>` / multi-coin-type support, if ever needed.
- Top-up deposits after creation.
