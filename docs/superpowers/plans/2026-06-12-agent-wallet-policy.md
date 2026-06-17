# AgentWallet PolicyObject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Nexus Sui Move smart contract package, `nexus_agent_wallet`, with a shared `PolicyObject` that enforces owner controls, agent authorization, budget limits, protocol allowlists, expiry, pause, revoke, and Walrus-linked action events.

**Architecture:** The package has one production module, `nexus_agent_wallet::policy`, and one test module. The policy object is shared so the approved agent can call `record_action`; owner-only methods check `tx_context::sender`. The MVP records approved actions and emits audit events but does not custody funds or call DeFi protocols.

**Tech Stack:** Sui CLI `1.70.2`, Sui Move 2024, `sui::clock`, `sui::event`, `sui::test_scenario`, and Move unit tests via `sui move test`.

---

## File Structure

- Create: `nexus_agent_wallet/Move.toml`
  - Package metadata and named address.
- Create: `nexus_agent_wallet/sources/policy.move`
  - `PolicyObject`, events, abort codes, public entry functions, public read helpers, and test-only object cleanup.
- Create: `nexus_agent_wallet/tests/policy_tests.move`
  - Move unit tests covering all behavior in the design spec.

The root `Nexus.md` and the design spec remain the product source of truth and contract design reference.

## Contract API Target

Implementation should converge on this public production API:

```move
public entry fun create_policy(
    agent: address,
    max_total_budget: u64,
    max_single_tx: u64,
    allowed_protocols: vector<vector<u8>>,
    expires_at_ms: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)

public entry fun pause_policy(policy: &mut PolicyObject, clock: &Clock, ctx: &TxContext)

public entry fun resume_policy(policy: &mut PolicyObject, clock: &Clock, ctx: &TxContext)

public entry fun revoke_policy(policy: &mut PolicyObject, clock: &Clock, ctx: &TxContext)

public entry fun record_action(
    policy: &mut PolicyObject,
    protocol_id: vector<u8>,
    amount: u64,
    walrus_blob_id: vector<u8>,
    clock: &Clock,
    ctx: &TxContext,
)
```

Read helpers for tests and frontend integration:

```move
public fun owner(policy: &PolicyObject): address
public fun agent(policy: &PolicyObject): address
public fun max_total_budget(policy: &PolicyObject): u64
public fun spent_total(policy: &PolicyObject): u64
public fun max_single_tx(policy: &PolicyObject): u64
public fun expires_at_ms(policy: &PolicyObject): u64
public fun paused(policy: &PolicyObject): bool
public fun revoked(policy: &PolicyObject): bool
public fun created_at_ms(policy: &PolicyObject): u64
public fun allowed_protocol_count(policy: &PolicyObject): u64
public fun is_protocol_allowed(policy: &PolicyObject, protocol_id: &vector<u8>): bool
```

## Abort Code Target

Use these exact private abort codes in `policy.move`. Tests assert these numeric abort codes directly.

```move
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
```

---

### Task 1: Scaffold The Move Package

**Files:**
- Create: `nexus_agent_wallet/Move.toml`
- Create: `nexus_agent_wallet/sources/policy.move`
- Create: `nexus_agent_wallet/tests/policy_tests.move`

- [ ] **Step 1: Generate the package skeleton**

Run:

```powershell
sui move new nexus_agent_wallet
```

Expected: creates `nexus_agent_wallet/Move.toml` and `nexus_agent_wallet/sources/`.

- [ ] **Step 2: Replace `Move.toml`**

Write this exact file:

```toml
[package]
name = "nexus_agent_wallet"
edition = "2024.beta"

[dependencies]
Sui = { git = "https://github.com/MystenLabs/sui.git", subdir = "crates/sui-framework/packages/sui-framework", rev = "framework/testnet" }

[addresses]
nexus_agent_wallet = "0x0"
```

- [ ] **Step 3: Create the initial empty module**

Write `nexus_agent_wallet/sources/policy.move`:

```move
module nexus_agent_wallet::policy {
}
```

- [ ] **Step 4: Create the initial empty test module**

Write `nexus_agent_wallet/tests/policy_tests.move`:

```move
#[test_only]
module nexus_agent_wallet::policy_tests {
}
```

- [ ] **Step 5: Run the empty package test**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: PASS with no tests or zero-test success.

---

### Task 2: Add Policy Creation Tests, Then Implement Creation

**Files:**
- Modify: `nexus_agent_wallet/sources/policy.move`
- Modify: `nexus_agent_wallet/tests/policy_tests.move`

- [ ] **Step 1: Write failing creation tests**

Replace `nexus_agent_wallet/tests/policy_tests.move` with:

```move
#[test_only]
module nexus_agent_wallet::policy_tests {
    use nexus_agent_wallet::policy;
    use std::vector;
    use sui::clock;
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

    #[test]
    fun create_policy_stores_owner_agent_limits_and_timing() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        clock::set_for_testing(&mut clock, 1_000);

        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            31_000,
            &clock,
            test::ctx(scenario),
        );

        test::next_tx(scenario, OWNER);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);

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

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 0)]
    fun create_policy_rejects_zero_total_budget() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 0, 100, protocols(), 31_000, &clock, test::ctx(scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1)]
    fun create_policy_rejects_zero_single_tx_limit() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 0, protocols(), 31_000, &clock, test::ctx(scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1)]
    fun create_policy_rejects_single_tx_limit_above_total_budget() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 501, protocols(), 31_000, &clock, test::ctx(scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 2)]
    fun create_policy_rejects_empty_protocol_list() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, vector[], 31_000, &clock, test::ctx(scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3)]
    fun create_policy_rejects_expiry_at_current_time() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(AGENT, 500, 100, protocols(), 1_000, &clock, test::ctx(scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3)]
    fun create_policy_rejects_expiry_before_current_time() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(AGENT, 500, 100, protocols(), 999, &clock, test::ctx(scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
}
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: FAIL because `PolicyObject`, abort constants, `create_policy`, and read helpers are not defined.

- [ ] **Step 3: Implement creation and read helpers**

Replace `nexus_agent_wallet/sources/policy.move` with:

```move
module nexus_agent_wallet::policy {
    use std::vector;
    use sui::clock::{Self, Clock};
    use sui::event;
    use sui::object::{Self, UID};
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
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let now = clock::timestamp_ms(clock);
        assert!(max_total_budget > 0, EInvalidBudget);
        assert!(max_single_tx > 0, EInvalidSingleTxLimit);
        assert!(max_single_tx <= max_total_budget, EInvalidSingleTxLimit);
        assert!(vector::length(&allowed_protocols) > 0, EEmptyProtocolList);
        assert!(expires_at_ms > now, EInvalidExpiry);

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

    public entry fun pause_policy(_policy: &mut PolicyObject, _clock: &Clock, _ctx: &TxContext) {
        abort ENotOwner
    }

    public entry fun resume_policy(_policy: &mut PolicyObject, _clock: &Clock, _ctx: &TxContext) {
        abort ENotOwner
    }

    public entry fun revoke_policy(_policy: &mut PolicyObject, _clock: &Clock, _ctx: &TxContext) {
        abort ENotOwner
    }

    public entry fun record_action(
        _policy: &mut PolicyObject,
        _protocol_id: vector<u8>,
        _amount: u64,
        _walrus_blob_id: vector<u8>,
        _clock: &Clock,
        _ctx: &TxContext,
    ) {
        abort ENotAgent
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
        } = policy;
        object::delete(id);
    }
}
```

- [ ] **Step 4: Run tests to verify GREEN for creation**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: PASS for creation tests. Stub lifecycle/action functions are allowed because no tests call them yet.

---

### Task 3: Add Owner Lifecycle Tests, Then Implement Pause, Resume, Revoke

**Files:**
- Modify: `nexus_agent_wallet/sources/policy.move`
- Modify: `nexus_agent_wallet/tests/policy_tests.move`

- [ ] **Step 1: Add failing lifecycle tests**

Append these tests inside `policy_tests` before the final `}`:

```move
    #[test]
    fun owner_can_pause_resume_and_revoke_policy() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, OWNER);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);

        policy::pause_policy(&mut policy_obj, &clock, test::ctx(scenario));
        assert!(policy::paused(&policy_obj), 0);

        policy::resume_policy(&mut policy_obj, &clock, test::ctx(scenario));
        assert!(!policy::paused(&policy_obj), 1);

        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(scenario));
        assert!(policy::revoked(&policy_obj), 2);

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_pause_policy() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(scenario));

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_resume_policy() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, OWNER);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(scenario));
        test::return_shared(policy_obj);

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::resume_policy(&mut policy_obj, &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4)]
    fun non_owner_cannot_revoke_policy() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: FAIL because owner lifecycle functions still abort or do not mutate state.

- [ ] **Step 3: Implement owner lifecycle functions**

Replace the three stub lifecycle functions in `policy.move` with:

```move
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
```

Add these private helpers near the bottom of `policy.move`, before `destroy_for_testing`:

```move
    fun assert_owner(policy: &PolicyObject, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == policy.owner, ENotOwner);
    }

    fun assert_agent(policy: &PolicyObject, ctx: &TxContext) {
        assert!(tx_context::sender(ctx) == policy.agent, ENotAgent);
    }

    fun assert_not_expired(policy: &PolicyObject, clock: &Clock) {
        assert!(clock::timestamp_ms(clock) <= policy.expires_at_ms, EPolicyExpired);
    }
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: PASS.

---

### Task 4: Add Agent Action Tests, Then Implement Record Action

**Files:**
- Modify: `nexus_agent_wallet/sources/policy.move`
- Modify: `nexus_agent_wallet/tests/policy_tests.move`

- [ ] **Step 1: Add failing valid-action test**

Append this test inside `policy_tests` before the final `}`:

```move
    #[test]
    fun approved_agent_can_record_valid_action_and_spend_total_updates() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);

        policy::record_action(
            &mut policy_obj,
            b"scallop",
            75,
            walrus_blob(),
            &clock,
            test::ctx(scenario),
        );

        assert!(policy::spent_total(&policy_obj) == 75, 0);

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
```

- [ ] **Step 2: Run tests to verify RED**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: FAIL because `record_action` still aborts with `ENotAgent`.

- [ ] **Step 3: Implement `record_action`**

Replace the `record_action` stub in `policy.move` with:

```move
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
```

- [ ] **Step 4: Run tests to verify GREEN**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: PASS.

---

### Task 5: Add Record Action Rejection Matrix

**Files:**
- Modify: `nexus_agent_wallet/tests/policy_tests.move`
- Modify only if needed: `nexus_agent_wallet/sources/policy.move`

- [ ] **Step 1: Add failing rejection tests**

Append these tests inside `policy_tests` before the final `}`:

```move
    #[test, expected_failure(abort_code = 5)]
    fun wrong_agent_cannot_record_action() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, @0xBAD);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 9)]
    fun disallowed_protocol_is_rejected() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"unknown", 75, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 10)]
    fun zero_amount_is_rejected() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 0, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 11)]
    fun amount_over_single_tx_limit_is_rejected() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 101, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 12)]
    fun cumulative_amount_over_total_budget_is_rejected() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 150, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 100, walrus_blob(), &clock, test::ctx(scenario));
        policy::record_action(&mut policy_obj, b"deepbook", 51, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 8)]
    fun expired_policy_rejects_actions() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));
        clock::set_for_testing(&mut clock, 31_001);

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 6)]
    fun paused_policy_rejects_actions() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, OWNER);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(scenario));
        test::return_shared(policy_obj);

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 7)]
    fun revoked_policy_rejects_actions() {
        let scenario = &mut test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(scenario));

        test::next_tx(scenario, OWNER);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(scenario));
        test::return_shared(policy_obj);

        test::next_tx(scenario, AGENT);
        let policy_obj = test::take_shared<policy::PolicyObject>(scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
```

- [ ] **Step 2: Run tests to verify expected failures are enforced**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: PASS if `record_action` already enforces all rejection conditions. If any test fails unexpectedly, fix only the relevant guard in `record_action`, then rerun.

---

### Task 6: Final Verification And Cleanup

**Files:**
- Inspect: `nexus_agent_wallet/sources/policy.move`
- Inspect: `nexus_agent_wallet/tests/policy_tests.move`
- Inspect: `docs/superpowers/specs/2026-06-12-agent-wallet-policy-design.md`

- [ ] **Step 1: Run full Move tests**

Run:

```powershell
sui move test --path .\nexus_agent_wallet
```

Expected: all tests PASS.

- [ ] **Step 2: Run a build with warnings as errors**

Run:

```powershell
sui move build --path .\nexus_agent_wallet --warnings-are-errors
```

Expected: build succeeds with no warnings.

- [ ] **Step 3: Compare implementation to the design spec**

Check that `policy.move` includes:

```text
PolicyObject fields:
id, owner, agent, max_total_budget, spent_total, max_single_tx,
allowed_protocols, expires_at_ms, paused, revoked, created_at_ms

Entry functions:
create_policy, pause_policy, resume_policy, revoke_policy, record_action

Events:
PolicyCreated, PolicyPaused, PolicyResumed, PolicyRevoked, ActionRecorded
```

Expected: no design requirement is missing.

- [ ] **Step 4: Check git status if this directory becomes a git repository**

Run:

```powershell
git status --short
```

Expected if git is initialized: only intentional files appear. If git is still not initialized, this command will print `fatal: not a git repository`; that is acceptable for the current workspace state.

---

## Execution Notes

- This plan intentionally keeps the MVP non-custodial. Do not add coin storage, protocol adapters, oracle logic, zkLogin, or backend code while executing this plan.
- Use TDD strictly: add each test, run it red, then implement only the code required to make it green.
- If a planned Move snippet needs small syntax adjustment for Sui Move 2024, preserve the behavior and rerun the targeted test before continuing.
