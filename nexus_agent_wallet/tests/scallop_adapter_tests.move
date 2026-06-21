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
}
