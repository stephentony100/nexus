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
    use protocol::reserve::MarketCoin;

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
    const EInsufficientVaultBalance: u64 = 14;

    public struct PolicyObject has key {
        id: UID,
        owner: address,
        agent: address,
        max_total_budget: u64,
        spent_total: u64,
        vault: Balance<SUI>,
        scallop_sui_position: Balance<MarketCoin<SUI>>,
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

    public struct FundsWithdrawn has copy, drop {
        policy_id: address,
        owner: address,
        amount: u64,
        remaining_balance: u64,
        timestamp_ms: u64,
    }

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

    public struct ScallopSupplyReceipt {
        amount: u64,
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
            vault: coin::into_balance(initial_deposit),
            scallop_sui_position: balance::zero(),
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

        assert!(amount <= policy.max_total_budget - policy.spent_total, ETotalBudgetExceeded);
        let new_spent_total = policy.spent_total + amount;
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

        let supplied_balance = balance::split(&mut policy.vault, amount);
        let supplied_coin = coin::from_balance(supplied_balance, ctx);
        let receipt = ScallopSupplyReceipt {
            amount,
            walrus_blob_id,
            timestamp_ms: clock::timestamp_ms(clock),
        };
        (supplied_coin, receipt)
    }

    public(package) fun complete_scallop_supply(
        policy: &mut PolicyObject,
        market_coin: Coin<MarketCoin<SUI>>,
        receipt: ScallopSupplyReceipt,
    ) {
        let ScallopSupplyReceipt { amount, walrus_blob_id, timestamp_ms } = receipt;
        balance::join(&mut policy.scallop_sui_position, coin::into_balance(market_coin));
        policy.spent_total = policy.spent_total + amount;

        event::emit(ScallopSuiSupplied {
            policy_id: object::uid_to_address(&policy.id),
            agent: policy.agent,
            amount,
            spent_total: policy.spent_total,
            vault_balance: balance::value(&policy.vault),
            scallop_position_balance: balance::value(&policy.scallop_sui_position),
            walrus_blob_id,
            timestamp_ms,
        });
    }

    public fun owner(policy: &PolicyObject): address { policy.owner }

    public fun agent(policy: &PolicyObject): address { policy.agent }

    public fun max_total_budget(policy: &PolicyObject): u64 { policy.max_total_budget }

    public fun spent_total(policy: &PolicyObject): u64 { policy.spent_total }

    public fun vault_balance(policy: &PolicyObject): u64 { balance::value(&policy.vault) }

    public fun scallop_sui_position_balance(policy: &PolicyObject): u64 {
        balance::value(&policy.scallop_sui_position)
    }

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
            vault,
            scallop_sui_position,
            max_single_tx: _,
            allowed_protocols: _,
            expires_at_ms: _,
            paused: _,
            revoked: _,
            created_at_ms: _,
        } = policy;
        balance::destroy_for_testing(vault);
        balance::destroy_for_testing(scallop_sui_position);
        object::delete(id);
    }
}
