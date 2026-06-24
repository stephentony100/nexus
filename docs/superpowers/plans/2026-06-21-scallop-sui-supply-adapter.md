# Scallop SUI Supply Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a supply-only on-chain Scallop adapter that atomically debits policy-custodied SUI, calls Scallop mint<SUI>, stores Balance<MarketCoin<SUI>> in PolicyObject, updates spent_total after mint succeeds, and emits an auditable event.

**Architecture:** The policy module owns all policy state and exposes package-visible prepare/complete helpers connected by a non-droppable ScallopSupplyReceipt. The new scallop_adapter module performs the real Scallop mint between those helpers. Unit tests use a test-only adapter entry that replaces only the external mint with a value-preserving MarketCoin balance while exercising the same production policy validation, debit, custody, accounting, and event path.

**Tech Stack:** Sui Move 2024, official Scallop Move package pinned at commit 2425b5b8b107bda10f4fa04517eb3cc009817249, Sui Move unit tests.

---

## File Structure

- Modify: nexus_agent_wallet/Move.toml
  - Add the immutable official Scallop dependency.
- Create: nexus_agent_wallet/Move.lock
  - Check in the complete mainnet dependency lock with immutable transitive revisions.
- Modify: nexus_agent_wallet/sources/policy.move
  - Add Scallop position state, receipt-gated prepare/complete helpers, event, and accessor.
- Create: nexus_agent_wallet/sources/scallop_adapter.move
  - Add production supply_sui and a test-only mint substitute.
- Modify: nexus_agent_wallet/tests/policy_tests.move
  - Assert a new policy starts with zero Scallop position.
- Create: nexus_agent_wallet/tests/scallop_adapter_tests.move
  - Cover happy path, all Nexus-side rejection paths, custody/accounting, and remaining idle withdrawal.

No TypeScript files change in this phase.

## Fixed Dependency

- Repository: https://github.com/scallop-io/sui-lending-protocol.git
- Subdirectory: contracts/protocol
- Revision: 2425b5b8b107bda10f4fa04517eb3cc009817249
- Current package: 0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a
- Type origin: 0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

---

### Task 1: Add And Lock The Official Scallop Dependency

**Files:**
- Modify: nexus_agent_wallet/Move.toml
- Create: nexus_agent_wallet/Move.lock

- [x] **Step 1: Add the immutable dependency**

Update nexus_agent_wallet/Move.toml to:

~~~toml
[package]
name = "nexus_agent_wallet"
edition = "2024.beta"

[dependencies]
protocol = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = "contracts/protocol", rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }

[addresses]
nexus_agent_wallet = "0x0"
~~~

- [x] **Step 2: Generate the mainnet lock and compile**

Run:

~~~powershell
sui move build --build-env mainnet
~~~

Working directory: nexus_agent_wallet

Expected: build succeeds and includes ScallopProtocol.

- [x] **Step 3: Verify immutable lock revisions**

Run:

~~~powershell
$lock = Get-Content -Raw .\Move.lock
$revs = [regex]::Matches($lock, 'rev = "([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$invalid = $revs | Where-Object { $_ -notmatch '^[0-9a-f]{40}$' }
if ($invalid) { throw "Floating lock revisions: $($invalid -join ', ')" }
if (-not $lock.Contains('2425b5b8b107bda10f4fa04517eb3cc009817249')) {
    throw 'Scallop revision is missing from Move.lock.'
}
"IMMUTABLE_LOCK_VERIFIED revisions=$($revs.Count)"
~~~

Expected: every Git revision is an immutable 40-character SHA.

- [x] **Step 4: Commit**

~~~powershell
git add nexus_agent_wallet/Move.toml nexus_agent_wallet/Move.lock
git commit -m "build: add pinned Scallop Move dependency"
~~~

---

### Task 2: Add Policy-Owned Scallop Position State

**Files:**
- Modify: nexus_agent_wallet/sources/policy.move
- Modify: nexus_agent_wallet/tests/policy_tests.move

- [x] **Step 1: Write the failing zero-position assertion**

In create_policy_stores_owner_agent_limits_and_timing, add:

~~~move
assert!(policy::scallop_sui_position_balance(&policy_obj) == 0, 14);
~~~

- [x] **Step 2: Run the focused test and verify failure**

Run:

~~~powershell
sui move test --build-env mainnet create_policy_stores_owner_agent_limits_and_timing
~~~

Working directory: nexus_agent_wallet

Expected: compile fails because scallop_sui_position_balance is not defined.

- [x] **Step 3: Add Scallop state and accessor**

In policy.move:

1. Import the type:

~~~move
use protocol::reserve::MarketCoin;
~~~

2. Add to PolicyObject after vault:

~~~move
scallop_sui_position: Balance<MarketCoin<SUI>>,
~~~

3. Initialize it in create_policy:

~~~move
scallop_sui_position: balance::zero(),
~~~

4. Add the accessor after vault_balance:

~~~move
public fun scallop_sui_position_balance(policy: &PolicyObject): u64 {
    balance::value(&policy.scallop_sui_position)
}
~~~

5. Destructure and destroy it in destroy_for_testing:

~~~move
scallop_sui_position,
~~~

and:

~~~move
balance::destroy_for_testing(scallop_sui_position);
~~~

- [x] **Step 4: Run the focused test**

~~~powershell
sui move test --build-env mainnet create_policy_stores_owner_agent_limits_and_timing
~~~

Expected: focused test passes.

- [x] **Step 5: Run all existing tests**

~~~powershell
sui move test --build-env mainnet
~~~

Expected: 33 passed, 0 failed.

- [x] **Step 6: Commit**

~~~powershell
git add nexus_agent_wallet/sources/policy.move nexus_agent_wallet/tests/policy_tests.move
git commit -m "feat: add policy-owned Scallop SUI position"
~~~

---

### Task 3: Implement Receipt-Gated Scallop Supply

**Files:**
- Modify: nexus_agent_wallet/sources/policy.move
- Create: nexus_agent_wallet/sources/scallop_adapter.move
- Create: nexus_agent_wallet/tests/scallop_adapter_tests.move

- [x] **Step 1: Write the failing happy-path test**

Create nexus_agent_wallet/tests/scallop_adapter_tests.move with the shared helpers and happy-path test below:

~~~move
#[test_only]
module nexus_agent_wallet::scallop_adapter_tests {
    use nexus_agent_wallet::policy;
    use nexus_agent_wallet::scallop_adapter;
    use sui::clock::{Self, Clock};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;
    use sui::test_scenario as test;

    const OWNER: address = @0xA11CE;
    const AGENT: address = @0xA6E17;
    const OTHER: address = @0xBAD;

    fun mint_deposit(scenario: &mut test::Scenario, amount: u64): Coin<SUI> {
        coin::mint_for_testing<SUI>(amount, test::ctx(scenario))
    }

    fun create_policy(
        scenario: &mut test::Scenario,
        clock: &Clock,
        allowed_protocols: vector<vector<u8>>,
        max_total_budget: u64,
        max_single_tx: u64,
    ) {
        policy::create_policy(
            AGENT,
            max_total_budget,
            max_single_tx,
            allowed_protocols,
            31_000,
            mint_deposit(scenario, max_total_budget),
            clock,
            test::ctx(scenario),
        );
    }

    fun take_policy(scenario: &test::Scenario): policy::PolicyObject {
        test::take_shared<policy::PolicyObject>(scenario)
    }

    fun supply(
        policy_obj: &mut policy::PolicyObject,
        amount: u64,
        clock: &Clock,
        scenario: &mut test::Scenario,
    ) {
        scallop_adapter::supply_sui_for_testing(
            policy_obj,
            amount,
            b"walrus-blob-001",
            clock,
            test::ctx(scenario),
        );
    }

    #[test]
    fun supply_sui_custodies_position_updates_accounting_and_leaves_idle_sui_withdrawable() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply(&mut policy_obj, 75, &clock, &mut scenario);

        assert!(policy::vault_balance(&policy_obj) == 425, 0);
        assert!(policy::spent_total(&policy_obj) == 75, 1);
        assert!(policy::scallop_sui_position_balance(&policy_obj) == 75, 2);
        test::return_shared(policy_obj);

        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = take_policy(&scenario);
        policy::owner_withdraw(&mut policy_obj, 425, &clock, test::ctx(&mut scenario));
        assert!(policy::vault_balance(&policy_obj) == 0, 3);
        assert!(policy::scallop_sui_position_balance(&policy_obj) == 75, 4);

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }
}
~~~

- [x] **Step 2: Run the focused test and verify failure**

Run from nexus_agent_wallet:

~~~powershell
sui move test --build-env mainnet supply_sui_custodies_position_updates_accounting_and_leaves_idle_sui_withdrawable
~~~

Expected: compile fails because nexus_agent_wallet::scallop_adapter does not exist.

- [x] **Step 3: Add the receipt, event, and policy helpers**

In policy.move, add the Scallop event and the non-droppable package receipt after FundsWithdrawn:

~~~move
public struct ScallopSuiSupplied has copy, drop {
    policy_id: address,
    agent: address,
    amount: u64,
    spent_total: u64,
    vault_balance: u64,
    scallop_position_balance: u64,
    walrus_blob_id: vector<u8>,
    timestamp_ms: u64,
}

public(package) struct ScallopSupplyReceipt {
    amount: u64,
    walrus_blob_id: vector<u8>,
    timestamp_ms: u64,
}
~~~

Add these helpers before the public accessors:

~~~move
public(package) fun prepare_scallop_supply(
    policy: &mut PolicyObject,
    amount: u64,
    walrus_blob_id: vector<u8>,
    clock: &Clock,
    ctx: &mut TxContext,
): (Coin<SUI>, ScallopSupplyReceipt) {
    assert_agent(policy, ctx);
    assert!(!policy.paused, EPolicyPaused);
    assert!(!policy.revoked, EPolicyRevoked);
    assert_not_expired(policy, clock);
    assert!(is_protocol_allowed(policy, &b"scallop"), EProtocolNotAllowed);
    assert!(amount > 0, EZeroAmount);
    assert!(amount <= policy.max_single_tx, ESingleTxLimitExceeded);
    assert!(amount <= policy.max_total_budget - policy.spent_total, ETotalBudgetExceeded);
    assert!(amount <= balance::value(&policy.vault), EInsufficientVaultBalance);

    let supplied = balance::split(&mut policy.vault, amount);
    let receipt = ScallopSupplyReceipt {
        amount,
        walrus_blob_id,
        timestamp_ms: clock::timestamp_ms(clock),
    };
    (coin::from_balance(supplied, ctx), receipt)
}

public(package) fun complete_scallop_supply(
    policy: &mut PolicyObject,
    market_coin: Coin<MarketCoin<SUI>>,
    receipt: ScallopSupplyReceipt,
) {
    let ScallopSupplyReceipt { amount, walrus_blob_id, timestamp_ms } = receipt;
    balance::join(&mut policy.scallop_sui_position, coin::into_balance(market_coin));

    let new_spent_total = policy.spent_total + amount;
    policy.spent_total = new_spent_total;

    event::emit(ScallopSuiSupplied {
        policy_id: object::uid_to_address(&policy.id),
        agent: policy.agent,
        amount,
        spent_total: new_spent_total,
        vault_balance: balance::value(&policy.vault),
        scallop_position_balance: balance::value(&policy.scallop_sui_position),
        walrus_blob_id,
        timestamp_ms,
    });
}
~~~

The receipt has no abilities. Code in this package cannot debit the vault and silently discard the receipt; it must either complete the supply or abort, which rolls back the transaction. spent_total changes only in complete_scallop_supply, after a MarketCoin has been returned.

- [x] **Step 4: Add the production adapter and test-only mint substitute**

Create nexus_agent_wallet/sources/scallop_adapter.move:

~~~move
#[allow(lint(public_entry))]
module nexus_agent_wallet::scallop_adapter {
    use nexus_agent_wallet::policy::{Self, PolicyObject};
    use protocol::market::Market;
    use protocol::mint;
    use protocol::reserve::MarketCoin;
    use protocol::version::Version;
    use sui::balance;
    use sui::clock::Clock;
    use sui::coin;
    use sui::sui::SUI;
    use sui::tx_context::TxContext;

    public entry fun supply_sui(
        policy_obj: &mut PolicyObject,
        amount: u64,
        walrus_blob_id: vector<u8>,
        scallop_version: &Version,
        scallop_market: &mut Market,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let (sui_coin, receipt) = policy::prepare_scallop_supply(
            policy_obj,
            amount,
            walrus_blob_id,
            clock,
            ctx,
        );
        let market_coin = mint::mint<SUI>(
            scallop_version,
            scallop_market,
            sui_coin,
            clock,
            ctx,
        );
        policy::complete_scallop_supply(policy_obj, market_coin, receipt);
    }

    #[test_only]
    public fun supply_sui_for_testing(
        policy_obj: &mut PolicyObject,
        amount: u64,
        walrus_blob_id: vector<u8>,
        clock: &Clock,
        ctx: &mut TxContext,
    ) {
        let (sui_coin, receipt) = policy::prepare_scallop_supply(
            policy_obj,
            amount,
            walrus_blob_id,
            clock,
            ctx,
        );
        let supplied_amount = coin::burn_for_testing(sui_coin);
        let market_balance = balance::create_for_testing<MarketCoin<SUI>>(supplied_amount);
        let market_coin = coin::from_balance(market_balance, ctx);
        policy::complete_scallop_supply(policy_obj, market_coin, receipt);
    }
}
~~~

- [x] **Step 5: Run the focused test**

~~~powershell
sui move test --build-env mainnet supply_sui_custodies_position_updates_accounting_and_leaves_idle_sui_withdrawable
~~~

Expected: 1 passed, 0 failed.

- [x] **Step 6: Commit**

~~~powershell
git add nexus_agent_wallet/sources/policy.move nexus_agent_wallet/sources/scallop_adapter.move nexus_agent_wallet/tests/scallop_adapter_tests.move
git commit -m "feat: add atomic Scallop SUI supply adapter"
~~~

---

### Task 4: Cover Every Nexus-Side Rejection Path

**Files:**
- Modify: nexus_agent_wallet/tests/scallop_adapter_tests.move

- [x] **Step 1: Add the nine exact failure tests**

Append these tests inside scallop_adapter_tests.move:

~~~move
#[test, expected_failure(abort_code = 5, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_non_agent() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);
    test::next_tx(&mut scenario, OTHER);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 75, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 6, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_paused_policy() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);
    test::next_tx(&mut scenario, OWNER);
    let mut policy_obj = take_policy(&scenario);
    policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
    test::return_shared(policy_obj);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 75, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 7, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_revoked_policy() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);
    test::next_tx(&mut scenario, OWNER);
    let mut policy_obj = take_policy(&scenario);
    policy::revoke_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
    test::return_shared(policy_obj);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 75, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 8, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_expired_policy() {
    let mut scenario = test::begin(OWNER);
    let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);
    clock::set_for_testing(&mut clock, 31_001);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 75, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 9, location = nexus_agent_wallet::policy)]
fun supply_sui_requires_scallop_allowlist_entry() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"deepbook"], 500, 100);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 75, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 10, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_zero_amount() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 0, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 11, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_amount_above_single_tx_limit() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 100);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 101, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 12, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_amount_above_remaining_budget() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 500);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 450, &clock, &mut scenario);
    supply(&mut policy_obj, 100, &clock, &mut scenario);
    abort 99
}

#[test, expected_failure(abort_code = 14, location = nexus_agent_wallet::policy)]
fun supply_sui_rejects_amount_above_idle_vault_balance() {
    let mut scenario = test::begin(OWNER);
    let clock = clock::create_for_testing(test::ctx(&mut scenario));
    create_policy(&mut scenario, &clock, vector[b"scallop"], 500, 500);
    test::next_tx(&mut scenario, OWNER);
    let mut policy_obj = take_policy(&scenario);
    policy::owner_withdraw(&mut policy_obj, 450, &clock, test::ctx(&mut scenario));
    test::return_shared(policy_obj);
    test::next_tx(&mut scenario, AGENT);
    let mut policy_obj = take_policy(&scenario);
    supply(&mut policy_obj, 100, &clock, &mut scenario);
    abort 99
}
~~~

The trailing abort 99 makes an unexpected successful call fail the test instead of silently passing. Expected failures name nexus_agent_wallet::policy because every rejection occurs in prepare_scallop_supply before any external protocol call.

- [x] **Step 2: Run the adapter test module**

~~~powershell
sui move test --build-env mainnet scallop_adapter_tests
~~~

Expected: 10 passed, 0 failed.

- [x] **Step 3: Run the complete Move suite**

~~~powershell
sui move test --build-env mainnet
~~~

Expected: 43 passed, 0 failed.

- [x] **Step 4: Commit**

~~~powershell
git add nexus_agent_wallet/tests/scallop_adapter_tests.move
git commit -m "test: cover Scallop supply policy guards"
~~~

---

### Task 5: Verify Production Linkage And Scope

**Files:**
- Verify: nexus_agent_wallet/Move.toml
- Verify: nexus_agent_wallet/Move.lock
- Verify: nexus_agent_wallet/sources/policy.move
- Verify: nexus_agent_wallet/sources/scallop_adapter.move
- Verify: nexus_agent_wallet/tests/policy_tests.move
- Verify: nexus_agent_wallet/tests/scallop_adapter_tests.move

- [x] **Step 1: Run a clean production build**

Run from nexus_agent_wallet:

~~~powershell
sui move build --build-env mainnet
~~~

Expected: build succeeds; nexus_agent_wallet::scallop_adapter compiles against protocol::mint::mint<SUI>.

- [x] **Step 2: Run all tests from a fresh command**

~~~powershell
sui move test --build-env mainnet
~~~

Expected: Test result: OK. Total tests: 43; passed: 43; failed: 0.

- [x] **Step 3: Re-verify immutable dependency linkage**

~~~powershell
$lock = Get-Content -Raw .\Move.lock
$revs = [regex]::Matches($lock, 'rev = "([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
$invalid = $revs | Where-Object { $_ -notmatch '^[0-9a-f]{40}$' }
if ($invalid) { throw "Floating lock revisions: $($invalid -join ', ')" }
if (-not $lock.Contains('2425b5b8b107bda10f4fa04517eb3cc009817249')) { throw 'Scallop SHA missing.' }
$manifest = Get-Content -Raw .\Move.toml
if (-not $manifest.Contains('https://github.com/scallop-io/sui-lending-protocol.git')) { throw 'Official Scallop repository missing.' }
"SCALLOP_LOCK_VERIFIED revisions=$($revs.Count)"
~~~

Expected: no floating revisions and the official Scallop SHA is present.

- [x] **Step 4: Verify scope and whitespace**

Run from the repository root:

~~~powershell
git diff --check main...HEAD
git diff --name-only main...HEAD
~~~

Expected changed production scope:

~~~text
nexus_agent_wallet/Move.lock
nexus_agent_wallet/Move.toml
nexus_agent_wallet/sources/policy.move
nexus_agent_wallet/sources/scallop_adapter.move
nexus_agent_wallet/tests/policy_tests.move
nexus_agent_wallet/tests/scallop_adapter_tests.move
~~~

The branch may also contain this implementation plan if execution starts from its documentation commit. No TypeScript, redeem, DeepBook, oracle, scheduler, API, or frontend files should change.

- [x] **Step 5: Inspect the final commit series**

~~~powershell
git log --oneline main..HEAD
git status --short
~~~

Expected: the dependency, state, adapter, and guard-test commits are present; the worktree is clean apart from pre-existing ignored or untracked user files.
