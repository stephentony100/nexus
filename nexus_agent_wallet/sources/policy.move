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
        } = policy;
        object::delete(id);
    }
}
