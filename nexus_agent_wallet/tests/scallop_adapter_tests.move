#[test_only, allow(unused_const)]
module nexus_agent_wallet::scallop_adapter_tests {
    use nexus_agent_wallet::policy::{Self, PolicyObject};
    use nexus_agent_wallet::scallop_adapter;
    use protocol::reserve::MarketCoin;
    use sui::balance;
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

    fun create_policy(scenario: &mut test::Scenario, clock: &Clock) {
        policy::create_policy(
            AGENT,
            500,
            100,
            vector[b"scallop"],
            31_000,
            mint_deposit(scenario, 500),
            clock,
            test::ctx(scenario),
        );
    }

    fun create_policy_with(
        scenario: &mut test::Scenario,
        clock: &Clock,
        allowed_protocols: vector<vector<u8>>,
        max_total_budget: u64,
        max_single_tx: u64,
        expires_at_ms: u64,
    ) {
        policy::create_policy(
            AGENT,
            max_total_budget,
            max_single_tx,
            allowed_protocols,
            expires_at_ms,
            mint_deposit(scenario, max_total_budget),
            clock,
            test::ctx(scenario),
        );
    }

    fun supply_amount(
        scenario: &mut test::Scenario,
        policy_obj: &mut PolicyObject,
        amount: u64,
        clock: &Clock,
    ) {
        scallop_adapter::supply_sui_for_testing(
            policy_obj,
            amount,
            b"walrus-blob-001",
            clock,
            test::ctx(scenario),
        );
    }

    fun take_policy(scenario: &test::Scenario): PolicyObject {
        test::take_shared<PolicyObject>(scenario)
    }

    fun supply(scenario: &mut test::Scenario, policy_obj: &mut PolicyObject, clock: &Clock) {
        scallop_adapter::supply_sui_for_testing(
            policy_obj,
            75,
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
        create_policy(&mut scenario, &clock);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply(&mut scenario, &mut policy_obj, &clock);
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

        test::next_tx(&mut scenario, OWNER);
        coin::burn_for_testing(test::take_from_sender<Coin<SUI>>(&scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 15, location = nexus_agent_wallet::policy)]
    fun scallop_supply_receipt_cannot_complete_against_another_policy() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        create_policy(&mut scenario, &clock);
        create_policy(&mut scenario, &clock);

        test::next_tx(&mut scenario, AGENT);
        let mut destination_policy = take_policy(&scenario);
        let mut source_policy = take_policy(&scenario);
        let (sui_coin, receipt) = policy::prepare_scallop_supply(
            &mut source_policy,
            75,
            b"walrus-blob-001",
            &clock,
            test::ctx(&mut scenario),
        );
        let supplied_amount = coin::burn_for_testing(sui_coin);
        let market_balance = balance::create_for_testing<MarketCoin<SUI>>(supplied_amount);
        let market_coin = coin::from_balance(market_balance, test::ctx(&mut scenario));

        policy::complete_scallop_supply(&mut destination_policy, market_coin, receipt);
        abort 99
    }

    #[test, expected_failure(abort_code = 5, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_non_agent() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 100, 31_000);
        test::next_tx(&mut scenario, OTHER);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 75, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 6, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_paused_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 100, 31_000);
        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = take_policy(&scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        test::return_shared(policy_obj);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 75, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 7, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_revoked_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 100, 31_000);
        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = take_policy(&scenario);
        policy::revoke_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));
        test::return_shared(policy_obj);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 75, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 8, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_expired_policy() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 100, 31_000);
        clock::set_for_testing(&mut clock, 31_001);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 75, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 9, location = nexus_agent_wallet::policy)]
    fun supply_sui_requires_scallop_allowlist_entry() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"deepbook"], 500, 100, 31_000);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 75, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 10, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_zero_amount() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 100, 31_000);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 0, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 11, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_amount_above_single_tx_limit() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 100, 31_000);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 101, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 12, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_amount_above_remaining_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 500, 31_000);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 450, &clock);
        supply_amount(&mut scenario, &mut policy_obj, 100, &clock);
        abort 99
    }

    #[test, expected_failure(abort_code = 14, location = nexus_agent_wallet::policy)]
    fun supply_sui_rejects_amount_above_idle_vault_balance() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        create_policy_with(&mut scenario, &clock, vector[b"scallop"], 500, 500, 31_000);
        test::next_tx(&mut scenario, OWNER);
        let mut policy_obj = take_policy(&scenario);
        policy::owner_withdraw(&mut policy_obj, 450, &clock, test::ctx(&mut scenario));
        test::return_shared(policy_obj);
        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = take_policy(&scenario);
        supply_amount(&mut scenario, &mut policy_obj, 100, &clock);
        abort 99
    }
}
