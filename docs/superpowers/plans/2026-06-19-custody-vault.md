# Custody Vault Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `PolicyObject` real on-chain custody of SUI — funded by the owner at creation, withdrawable by the owner at any time, with a read-only balance query — per `docs/superpowers/specs/2026-06-19-custody-vault-design.md`.

**Architecture:** `PolicyObject` gains a `vault: Balance<SUI>` field. `create_policy` takes a new `initial_deposit: Coin<SUI>` argument that must exactly equal `max_total_budget`, converted via `coin::into_balance` into the vault. A new `owner_withdraw` entry function lets the owner pull funds out via `balance::split`/`coin::from_balance`, regardless of paused/revoked/expired state. A new `vault_balance` read-only accessor exposes the current balance. `record_action` and all other existing functions are untouched. `intentflow`'s `buildCreatePolicyPtb` is updated to split the deposit from the sender's gas coin and pass it in the new argument position.

**Tech Stack:** Sui Move 2024 edition (`sui::balance`, `sui::coin`, `sui::sui::SUI`, `sui::test_scenario`), TypeScript (`@mysten/sui/transactions`), vitest.

## Global Constraints

- Coin type is fixed to `SUI` for every policy — `PolicyObject` stays non-generic.
- `initial_deposit`'s value must exactly equal `max_total_budget` (`EDepositMismatch` abort if not), checked in `create_policy`.
- No top-up deposits after creation — the vault is funded once, at `create_policy` time.
- `owner_withdraw` has no paused/revoked/expiry checks — the owner can always reclaim their own funds.
- `owner_withdraw` takes `ctx: &mut TxContext` (not `&TxContext`) — `coin::from_balance` requires a mutable `TxContext`.
- No agent-facing fund movement in this phase — deferred to Phase 2 (Protocol Adapter).
- `record_action`'s behavior and signature are unchanged.
- New abort codes: `EDepositMismatch = 13`, `EInsufficientVaultBalance = 14`. All existing abort codes (0–12) are unchanged.
- In `intentflow/src/ptbBuilder.ts`, the split deposit argument is inserted after `tx.pure.u64(strategy.expiresAtMs)` and before the `tx.sharedObjectRef(...)` clock argument — matching the new Move parameter order exactly.
- Zero changes to `actionflow`, `agentrunner`, `policyloop`, or `intentflow/src/types.ts`/`extractor.ts`/`validator.ts`.

---

## File Structure

- `nexus_agent_wallet/sources/policy.move` — add `vault` field, fund `create_policy`, add `owner_withdraw` + `vault_balance` + `FundsWithdrawn` event + two new error consts, update `destroy_for_testing`.
- `nexus_agent_wallet/tests/policy_tests.move` — add `mint_deposit` test helper, update all 22 existing `create_policy` call sites with the new deposit argument, add 10 new tests (2 deposit-validation + 8 `owner_withdraw`).
- `intentflow/src/ptbBuilder.ts` — `buildCreatePolicyPtb` splits the deposit from `tx.gas` and inserts it in the new argument position.
- `intentflow/src/ptbBuilder.test.ts` — argument-count assertion updated to 7, new test asserting the `SplitCoins` command shape.

---

### Task 1: Vault field, funded `create_policy`, `vault_balance`

**Files:**
- Modify: `nexus_agent_wallet/sources/policy.move`
- Modify: `nexus_agent_wallet/tests/policy_tests.move`

**Interfaces:**
- Produces: `PolicyObject.vault: Balance<SUI>` field; `create_policy`'s new 6th parameter `initial_deposit: Coin<SUI>` (inserted after `expires_at_ms`, before `clock`); `public fun vault_balance(policy: &PolicyObject): u64`; new error consts `EDepositMismatch: u64 = 13`.
- Consumed by: Task 2 (`owner_withdraw` uses `policy.vault` and `vault_balance`), Task 3 (`ptbBuilder.ts` passes the new argument).

- [ ] **Step 1: Replace `nexus_agent_wallet/sources/policy.move` with the funded version**

Write the complete file:

```move
#[allow(duplicate_alias, lint(public_entry))]
module nexus_agent_wallet::policy {
    use std::vector;
    use sui::balance::{Self, Balance};
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::event;
    use sui::object::{Self, UID};
    use sui::sui::SUI;
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    const EInvalidBudget: u64 = 0;
    const EInvalidSingleTxLimit: u64 = 1;
    const EEmptyProtocolList: u64 = 2;
    const EInvalidExpiry: u64 = 3;
    const ENotOwner: u64 = 4;
    const ENotAgent: u64 = 5;
    const EPolicyPaused: u64 = 6;
    const EPolicyRevoked: u64 = 7;
    const EPolicyExpired: u64 = 8;
    const EProtocolNotAllowed: u64 = 9;
    const EZeroAmount: u64 = 10;
    const ESingleTxLimitExceeded: u64 = 11;
    const ETotalBudgetExceeded: u64 = 12;
    const EDepositMismatch: u64 = 13;

    public struct PolicyObject has key {
        id: UID,
        owner: address,
        agent: address,
        max_total_budget: u64,
        spent_total: u64,
        max_single_tx: u64,
        allowed_protocols: vector<vector<u8>>,
        expires_at_ms: u64,
        paused: bool,
        revoked: bool,
        created_at_ms: u64,
        vault: Balance<SUI>,
    }

    public struct PolicyCreated has copy, drop {
        policy_id: address,
        owner: address,
        agent: address,
        max_total_budget: u64,
        max_single_tx: u64,
        expires_at_ms: u64,
        created_at_ms: u64,
    }

    public struct PolicyPaused has copy, drop {
        policy_id: address,
        owner: address,
        timestamp_ms: u64,
    }

    public struct PolicyResumed has copy, drop {
        policy_id: address,
        owner: address,
        timestamp_ms: u64,
    }

    public struct PolicyRevoked has copy, drop {
        policy_id: address,
        owner: address,
        timestamp_ms: u64,
    }

    public struct ActionRecorded has copy, drop {
        policy_id: address,
        agent: address,
        protocol_id: vector<u8>,
        amount: u64,
        spent_total: u64,
        walrus_blob_id: vector<u8>,
        timestamp_ms: u64,
    }

    public entry fun create_policy(
        agent: address,
        max_total_budget: u64,
        max_single_tx: u64,
        allowed_protocols: vector<vector<u8>>,
        expires_at_ms: u64,
        initial_deposit: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(max_total_budget > 0, EInvalidBudget);
        assert!(max_single_tx > 0, EInvalidSingleTxLimit);
        assert!(max_single_tx <= max_total_budget, EInvalidSingleTxLimit);
        assert!(vector::length(&allowed_protocols) > 0, EEmptyProtocolList);
        assert!(expires_at_ms > now, EInvalidExpiry);
        assert!(coin::value(&initial_deposit) == max_total_budget, EDepositMismatch);

        let owner = tx_context::sender(ctx);
        let policy = PolicyObject {
            id: object::new(ctx),
            owner,
            agent,
            max_total_budget,
            spent_total: 0,
            max_single_tx,
            allowed_protocols,
            expires_at_ms,
            paused: false,
            revoked: false,
            created_at_ms: now,
            vault: coin::into_balance(initial_deposit),
        };
        let policy_id = object::uid_to_address(&policy.id);

        event::emit(PolicyCreated {
            policy_id,
            owner,
            agent,
            max_total_budget,
            max_single_tx,
            expires_at_ms,
            created_at_ms: now,
        });

        transfer::share_object(policy);
    }

    public entry fun pause_policy(policy: &mut PolicyObject, clock: &Clock, ctx: &TxContext) {
        assert_owner(policy, ctx);
        assert!(!policy.revoked, EPolicyRevoked);

        policy.paused = true;

        event::emit(PolicyPaused {
            policy_id: object::uid_to_address(&policy.id),
            owner: policy.owner,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public entry fun resume_policy(policy: &mut PolicyObject, clock: &Clock, ctx: &TxContext) {
        assert_owner(policy, ctx);
        assert!(!policy.revoked, EPolicyRevoked);
        assert_not_expired(policy, clock);

        policy.paused = false;

        event::emit(PolicyResumed {
            policy_id: object::uid_to_address(&policy.id),
            owner: policy.owner,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public entry fun revoke_policy(policy: &mut PolicyObject, clock: &Clock, ctx: &TxContext) {
        assert_owner(policy, ctx);

        policy.revoked = true;

        event::emit(PolicyRevoked {
            policy_id: object::uid_to_address(&policy.id),
            owner: policy.owner,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public entry fun record_action(
        policy: &mut PolicyObject,
        protocol_id: vector<u8>,
        amount: u64,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &TxContext,
    ) {
        assert_agent(policy, ctx);
        assert!(!policy.paused, EPolicyPaused);
        assert!(!policy.revoked, EPolicyRevoked);
        assert_not_expired(policy, clock);
        assert!(is_protocol_allowed(policy, &protocol_id), EProtocolNotAllowed);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= policy.max_single_tx, ESingleTxLimitExceeded);

        let new_spent_total = policy.spent_total + amount;
        assert!(new_spent_total <= policy.max_total_budget, ETotalBudgetExceeded);
        policy.spent_total = new_spent_total;

        event::emit(ActionRecorded {
            policy_id: object::uid_to_address(&policy.id),
            agent: policy.agent,
            protocol_id,
            amount,
            spent_total: new_spent_total,
            walrus_blob_id,
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public fun owner(policy: &PolicyObject): address { policy.owner }

    public fun agent(policy: &PolicyObject): address { policy.agent }

    public fun max_total_budget(policy: &PolicyObject): u64 { policy.max_total_budget }

    public fun spent_total(policy: &PolicyObject): u64 { policy.spent_total }

    public fun max_single_tx(policy: &PolicyObject): u64 { policy.max_single_tx }

    public fun expires_at_ms(policy: &PolicyObject): u64 { policy.expires_at_ms }

    public fun paused(policy: &PolicyObject): bool { policy.paused }

    public fun revoked(policy: &PolicyObject): bool { policy.revoked }

    public fun created_at_ms(policy: &PolicyObject): u64 { policy.created_at_ms }

    public fun allowed_protocol_count(policy: &PolicyObject): u64 {
        vector::length(&policy.allowed_protocols)
    }

    public fun is_protocol_allowed(policy: &PolicyObject, protocol_id: &vector<u8>): bool {
        vector::contains(&policy.allowed_protocols, protocol_id)
    }

    public fun vault_balance(policy: &PolicyObject): u64 { balance::value(&policy.vault) }

    fun assert_owner(policy: &PolicyObject, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
    }

    fun assert_agent(policy: &PolicyObject, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == policy.agent, ENotAgent);
    }

    fun assert_not_expired(policy: &PolicyObject, clock: &Clock) {
        assert!(clock::timestamp_ms(clock) <= policy.expires_at_ms, EPolicyExpired);
    }

    #[test_only]
    public fun destroy_for_testing(policy: PolicyObject) {
        let PolicyObject {
            id,
            owner: _,
            agent: _,
            max_total_budget: _,
            spent_total: _,
            max_single_tx: _,
            allowed_protocols: _,
            expires_at_ms: _,
            paused: _,
            revoked: _,
            created_at_ms: _,
            vault,
        } = policy;
        balance::destroy_for_testing(vault);
        object::delete(id);
    }
}
```

- [ ] **Step 2: Replace `nexus_agent_wallet/tests/policy_tests.move` with the migrated version**

Every existing `create_policy` call site gets a new `mint_deposit(&mut scenario, <budget>)` argument inserted after `expires_at_ms` and before `clock`, matching the `<budget>` value used in that test (so the deposit-equality check always passes unless the test is specifically about an invalid budget, in which case the existing budget check aborts before the deposit check is ever reached). A `vault_balance` assertion is folded into the first test. Two new tests cover the deposit-mismatch cases.

Write the complete file:

```move
#[test_only]
module nexus_agent_wallet::policy_tests {
    use nexus_agent_wallet::policy;
    use std::vector;
    use sui::clock;
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario as test;

    const OWNER: address = @0xA11CE;
    const AGENT: address = @0xA6E17;

    fun protocols(): vector<vector<u8>> {
        vector[
            b"scallop",
            b"deepbook",
        ]
    }

    fun walrus_blob(): vector<u8> {
        b"walrus-blob-001"
    }

    fun mint_deposit(scenario: &mut test::Scenario, amount: u64): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, test::ctx(scenario))
    }

    #[test]
    fun create_policy_stores_owner_agent_limits_and_timing() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);

        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 500),
            &clock,
            test::ctx(&mut scenario),
        );

        test::next_tx(&mut scenario, OWNER);
        let policy_obj = test::take_shared<policy::PolicyObject>(&scenario);

        assert!(policy::owner(&policy_obj) == OWNER, 0);
        assert!(policy::agent(&policy_obj) == AGENT, 1);
        assert!(policy::max_total_budget(&policy_obj) == 500, 2);
        assert!(policy::spent_total(&policy_obj) == 0, 3);
        assert!(policy::max_single_tx(&policy_obj) == 100, 4);
        assert!(policy::expires_at_ms(&policy_obj) == 31_000, 5);
        assert!(policy::created_at_ms(&policy_obj) == 1_000, 6);
        assert!(!policy::paused(&policy_obj), 7);
        assert!(!policy::revoked(&policy_obj), 8);
        assert!(policy::allowed_protocol_count(&policy_obj) == 2, 9);
        assert!(policy::is_protocol_allowed(&policy_obj, &b"scallop"), 10);
        assert!(policy::is_protocol_allowed(&policy_obj, &b"deepbook"), 11);
        assert!(!policy::is_protocol_allowed(&policy_obj, &b"unknown"), 12);
        assert!(policy::vault_balance(&policy_obj) == 500, 13);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 0)]
    fun create_policy_rejects_zero_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 0, 100, protocols(), 31_000, mint_deposit(&mut scenario, 0), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1)]
    fun create_policy_rejects_zero_single_tx_limit() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 0, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1)]
    fun create_policy_rejects_single_tx_limit_above_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 501, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 2)]
    fun create_policy_rejects_empty_protocol_list() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, vector[], 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3)]
    fun create_policy_rejects_expiry_at_current_time() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(AGENT, 500, 100, protocols(), 1_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3)]
    fun create_policy_rejects_expiry_before_current_time() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(AGENT, 500, 100, protocols(), 999, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 13)]
    fun create_policy_rejects_deposit_below_max_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 499), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 13)]
    fun create_policy_rejects_deposit_above_max_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 501), &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_can_pause_resume_and_revoke_policy() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);

        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        assert!(policy::paused(&policy_obj), 0);

        policy::resume_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        assert!(!policy::paused(&policy_obj), 1);

        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        assert!(policy::revoked(&policy_obj), 2);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_pause_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_resume_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        test::return_shared(policy_obj);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::resume_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_revoke_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun approved_agent_can_record_valid_action_and_spend_total_updates() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);

        policy::record_action(
            &mut policy_obj,
            b"scallop",
            75,
            walrus_blob(),
            &clock,
            test::ctx(&mut scenario),
        );

        assert!(policy::spent_total(&policy_obj) == 75, 0);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 5)]
    fun wrong_agent_cannot_record_action() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, @0xBAD);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 9)]
    fun disallowed_protocol_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"unknown", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 10)]
    fun zero_amount_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 0, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 11)]
    fun amount_over_single_tx_limit_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 101, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 12)]
    fun cumulative_amount_over_total_budget_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 150, 100, protocols(), 31_000, mint_deposit(&mut scenario, 150), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 100, walrus_blob(), &clock, test::ctx(&mut scenario));
        policy::record_action(&mut policy_obj, b"deepbook", 51, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 8)]
    fun expired_policy_rejects_actions() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 31_001);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 6)]
    fun paused_policy_rejects_actions() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        test::return_shared(policy_obj);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 7)]
    fun revoked_policy_rejects_actions() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        test::return_shared(policy_obj);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun amount_equal_to_single_tx_limit_succeeds() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);

        policy::record_action(&mut policy_obj, b"scallop", 100, walrus_blob(), &clock, test::ctx(&mut scenario));

        assert!(policy::spent_total(&policy_obj) == 100, 0);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun cumulative_amount_equal_to_total_budget_succeeds() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 150, 100, protocols(), 31_000, mint_deposit(&mut scenario, 150), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);

        policy::record_action(&mut policy_obj, b"scallop", 100, walrus_blob(), &clock, test::ctx(&mut scenario));
        policy::record_action(&mut policy_obj, b"deepbook", 50, walrus_blob(), &clock, test::ctx(&mut scenario));

        assert!(policy::spent_total(&policy_obj) == 150, 0);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
}
```

- [ ] **Step 3: Run the test suite**

Run: `cd nexus_agent_wallet && sui move test`
Expected: `Test result: OK. Total tests: 24; passed: 24; failed: 0` (22 migrated + 2 new deposit-mismatch tests).

- [ ] **Step 4: Commit**

```bash
git add nexus_agent_wallet/sources/policy.move nexus_agent_wallet/tests/policy_tests.move
git commit -m "policy: add owner-funded custody vault to PolicyObject"
```

---

### Task 2: `owner_withdraw` and `FundsWithdrawn` event

**Files:**
- Modify: `nexus_agent_wallet/sources/policy.move`
- Modify: `nexus_agent_wallet/tests/policy_tests.move`

**Interfaces:**
- Consumes: `policy.vault: Balance<SUI>` and `vault_balance` from Task 1.
- Produces: `public entry fun owner_withdraw(policy: &mut PolicyObject, amount: u64, clock: &Clock, ctx: &mut TxContext)`; `FundsWithdrawn` event; `EInsufficientVaultBalance: u64 = 14`. Nothing downstream depends on this (Phase 2 is a separate future spec).

- [ ] **Step 1: Add `EInsufficientVaultBalance` const**

In `nexus_agent_wallet/sources/policy.move`, find:

```move
    const EDepositMismatch: u64 = 13;
```

Replace with:

```move
    const EDepositMismatch: u64 = 13;
    const EInsufficientVaultBalance: u64 = 14;
```

- [ ] **Step 2: Add `FundsWithdrawn` event struct**

Find:

```move
    public struct ActionRecorded has copy, drop {
        policy_id: address,
        agent: address,
        protocol_id: vector<u8>,
        amount: u64,
        spent_total: u64,
        walrus_blob_id: vector<u8>,
        timestamp_ms: u64,
    }
```

Replace with:

```move
    public struct ActionRecorded has copy, drop {
        policy_id: address,
        agent: address,
        protocol_id: vector<u8>,
        amount: u64,
        spent_total: u64,
        walrus_blob_id: vector<u8>,
        timestamp_ms: u64,
    }

    public struct FundsWithdrawn has copy, drop {
        policy_id: address,
        owner: address,
        amount: u64,
        remaining_balance: u64,
        timestamp_ms: u64,
    }
```

- [ ] **Step 3: Add `owner_withdraw` after `record_action`**

Find the end of `record_action` (the line directly before `public fun owner(`):

```move
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public fun owner(policy: &PolicyObject): address { policy.owner }
```

Replace with:

```move
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public entry fun owner_withdraw(
        policy: &mut PolicyObject,
        amount: u64,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        assert_owner(policy, ctx);
        assert!(amount > 0, EZeroAmount);
        assert!(amount <= balance::value(&policy.vault), EInsufficientVaultBalance);

        let withdrawn = balance::split(&mut policy.vault, amount);
        let coin_out = coin::from_balance(withdrawn, ctx);
        transfer::public_transfer(coin_out, tx_context::sender(ctx));

        event::emit(FundsWithdrawn {
            policy_id: object::uid_to_address(&policy.id),
            owner: policy.owner,
            amount,
            remaining_balance: balance::value(&policy.vault),
            timestamp_ms: clock::timestamp_ms(clock),
        });
    }

    public fun owner(policy: &PolicyObject): address { policy.owner }
```

- [ ] **Step 4: Append 8 new tests to `nexus_agent_wallet/tests/policy_tests.move`**

Find the closing of the module (the last two lines):

```move
        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
}
```

This is the end of `cumulative_amount_equal_to_total_budget_succeeds` (the last test in the file). Replace with:

```move
        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_can_withdraw_partial_amount_and_vault_balance_reflects_it() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::owner_withdraw(&mut policy_obj, 200, &clock, test::ctx(&mut scenario));
        assert!(policy::vault_balance(&policy_obj) == 300, 0);
        test::return_shared(policy_obj);

        test::next_tx(&mut scenario, OWNER);
        let withdrawn = test::take_from_sender<Coin<SUI>>(&scenario);
        assert!(coin::value(&withdrawn) == 200, 1);
        coin::burn_for_testing(withdrawn);

        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_can_withdraw_full_balance_down_to_zero() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::owner_withdraw(&mut policy_obj, 500, &clock, test::ctx(&mut scenario));
        assert!(policy::vault_balance(&policy_obj) == 0, 0);
        test::return_shared(policy_obj);

        test::next_tx(&mut scenario, OWNER);
        let withdrawn = test::take_from_sender<Coin<SUI>>(&scenario);
        assert!(coin::value(&withdrawn) == 500, 1);
        coin::burn_for_testing(withdrawn);

        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 10)]
    fun owner_withdraw_rejects_zero_amount() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::owner_withdraw(&mut policy_obj, 0, &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 14)]
    fun owner_withdraw_rejects_amount_above_vault_balance() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::owner_withdraw(&mut policy_obj, 501, &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_withdraw() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::owner_withdraw(&mut policy_obj, 100, &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_withdraw_succeeds_while_paused() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        policy::owner_withdraw(&mut policy_obj, 100, &clock, test::ctx(&mut scenario));
        assert!(policy::vault_balance(&policy_obj) == 400, 0);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_withdraw_succeeds_while_revoked() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        policy::owner_withdraw(&mut policy_obj, 100, &clock, test::ctx(&mut scenario));
        assert!(policy::vault_balance(&policy_obj) == 400, 0);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_withdraw_succeeds_while_expired() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, mint_deposit(&mut scenario, 500), &clock, test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 31_001);

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::owner_withdraw(&mut policy_obj, 100, &clock, test::ctx(&mut scenario));
        assert!(policy::vault_balance(&policy_obj) == 400, 0);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
}
```

- [ ] **Step 5: Run the full test suite**

Run: `cd nexus_agent_wallet && sui move test`
Expected: `Test result: OK. Total tests: 32; passed: 32; failed: 0` (24 from Task 1 + 8 new `owner_withdraw` tests).

- [ ] **Step 6: Commit**

```bash
git add nexus_agent_wallet/sources/policy.move nexus_agent_wallet/tests/policy_tests.move
git commit -m "policy: add owner_withdraw and FundsWithdrawn event"
```

---

### Task 3: `intentflow` PTB builder update

**Files:**
- Modify: `intentflow/src/ptbBuilder.ts`
- Modify: `intentflow/src/ptbBuilder.test.ts`

**Interfaces:**
- Consumes: the new `create_policy` Move signature from Task 1/2 (`initial_deposit: Coin<SUI>` inserted after `expires_at_ms`, before `clock`). `PolicyStrategy`'s shape from `intentflow/src/types.ts` is unchanged — reuses `strategy.maxTotalBudget`.
- Produces: nothing new downstream — `actionflow`, `agentrunner`, `policyloop` never call `create_policy` and are untouched.

- [ ] **Step 1: Update `buildCreatePolicyPtb` to split and pass the deposit**

In `intentflow/src/ptbBuilder.ts`, find:

```typescript
export function buildCreatePolicyPtb(strategy: PolicyStrategy, packageId: string): Transaction {
  const tx = new Transaction()

  const allowedProtocolsBytes = strategy.allowedProtocols.map((protocol) =>
    Array.from(new TextEncoder().encode(protocol)),
  )

  tx.moveCall({
    target: `${packageId}::policy::create_policy`,
    arguments: [
      tx.pure.address(strategy.agentAddress),
      tx.pure.u64(strategy.maxTotalBudget),
      tx.pure.u64(strategy.maxSingleTx),
      tx.pure.vector('vector<u8>', allowedProtocolsBytes),
      tx.pure.u64(strategy.expiresAtMs),
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}
```

Replace with:

```typescript
export function buildCreatePolicyPtb(strategy: PolicyStrategy, packageId: string): Transaction {
  const tx = new Transaction()

  const allowedProtocolsBytes = strategy.allowedProtocols.map((protocol) =>
    Array.from(new TextEncoder().encode(protocol)),
  )

  const [initialDeposit] = tx.splitCoins(tx.gas, [tx.pure.u64(strategy.maxTotalBudget)])

  tx.moveCall({
    target: `${packageId}::policy::create_policy`,
    arguments: [
      tx.pure.address(strategy.agentAddress),
      tx.pure.u64(strategy.maxTotalBudget),
      tx.pure.u64(strategy.maxSingleTx),
      tx.pure.vector('vector<u8>', allowedProtocolsBytes),
      tx.pure.u64(strategy.expiresAtMs),
      initialDeposit,
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}
```

- [ ] **Step 2: Update the argument-count test and add a `SplitCoins` shape test**

In `intentflow/src/ptbBuilder.test.ts`, find:

```typescript
    expect(moveCalls).toHaveLength(1)
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('create_policy')
    expect(call.arguments).toHaveLength(6)
  })

  it('builds to bytes without requiring a network client', async () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
```

Replace with:

```typescript
    expect(moveCalls).toHaveLength(1)
    const call = moveCalls[0].MoveCall
    expect(call.package).toBe(PACKAGE_ID)
    expect(call.module).toBe('policy')
    expect(call.function).toBe('create_policy')
    expect(call.arguments).toHaveLength(7)
  })

  it('splits the deposit from the sender gas coin', () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const data = tx.getData()
    const splitCommands = data.commands.filter(
      (c): c is { $kind: 'SplitCoins'; SplitCoins: { coin: unknown; amounts: unknown[] } } =>
        c.$kind === 'SplitCoins',
    )

    expect(splitCommands).toHaveLength(1)
    expect(splitCommands[0].SplitCoins.coin).toEqual({ $kind: 'GasCoin', GasCoin: true })
  })

  it('builds to bytes without requiring a network client', async () => {
    const tx = buildCreatePolicyPtb(STRATEGY, PACKAGE_ID)
    const bytes = await tx.build({ onlyTransactionKind: true })
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 3: Run the test suite**

Run: `cd intentflow && npx vitest run`
Expected: all tests pass, including the updated argument-count test and the new `SplitCoins` test.

- [ ] **Step 4: Type-check**

Run: `cd intentflow && npx tsc --noEmit -p .`
Expected: exit code 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add intentflow/src/ptbBuilder.ts intentflow/src/ptbBuilder.test.ts
git commit -m "intentflow: fund create_policy's deposit from the sender's gas coin"
```
