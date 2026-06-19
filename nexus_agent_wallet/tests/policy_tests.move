#[test_only]
module nexus_agent_wallet::policy_tests {
    use nexus_agent_wallet::policy;
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
        assert!(policy::vault_balance(&policy_obj) == 500, 13);
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

    #[test, expected_failure(abort_code = 0, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_zero_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            0,
            100,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 0),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_zero_single_tx_limit() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            500,
            0,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 500),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_single_tx_limit_above_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            500,
            501,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 500),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 2, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_empty_protocol_list() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            500,
            100,
            vector[],
            31_000,
            mint_deposit(&mut scenario, 500),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_expiry_at_current_time() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            1_000,
            mint_deposit(&mut scenario, 500),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_expiry_before_current_time() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            999,
            mint_deposit(&mut scenario, 500),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 13, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_deposit_below_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 499),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 13, location = nexus_agent_wallet::policy)]
    fun create_policy_rejects_deposit_above_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 501),
            &clock,
            test::ctx(&mut scenario),
        );
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_can_pause_resume_and_revoke_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

    #[test, expected_failure(abort_code = 4, location = nexus_agent_wallet::policy)]
    fun non_owner_cannot_pause_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::pause_policy(&mut policy_obj, &clock, test::ctx(&mut scenario));

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 4, location = nexus_agent_wallet::policy)]
    fun non_owner_cannot_resume_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

    #[test, expected_failure(abort_code = 4, location = nexus_agent_wallet::policy)]
    fun non_owner_cannot_revoke_policy() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

    #[test, expected_failure(abort_code = 5, location = nexus_agent_wallet::policy)]
    fun wrong_agent_cannot_record_action() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

        test::next_tx(&mut scenario, @0xBAD);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 9, location = nexus_agent_wallet::policy)]
    fun disallowed_protocol_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"unknown", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 10, location = nexus_agent_wallet::policy)]
    fun zero_amount_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 0, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 11, location = nexus_agent_wallet::policy)]
    fun amount_over_single_tx_limit_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 101, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 12, location = nexus_agent_wallet::policy)]
    fun cumulative_amount_over_total_budget_is_rejected() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(
            AGENT,
            150,
            100,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 150),
            &clock,
            test::ctx(&mut scenario),
        );

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 100, walrus_blob(), &clock, test::ctx(&mut scenario));
        policy::record_action(&mut policy_obj, b"deepbook", 51, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 12, location = nexus_agent_wallet::policy)]
    fun record_action_rejects_total_budget_exceeded_before_addition_overflow() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        let max_u64 = 18446744073709551615;
        policy::create_policy(
            AGENT,
            max_u64,
            max_u64,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, max_u64),
            &clock,
            test::ctx(&mut scenario),
        );

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", max_u64, walrus_blob(), &clock, test::ctx(&mut scenario));
        assert!(policy::spent_total(&policy_obj) == max_u64, 0);

        policy::record_action(&mut policy_obj, b"deepbook", 1, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 8, location = nexus_agent_wallet::policy)]
    fun expired_policy_rejects_actions() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
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
        clock::set_for_testing(&mut clock, 31_001);

        test::next_tx(&mut scenario, AGENT);
        let mut policy_obj = test::take_shared<policy::PolicyObject>(&scenario);
        policy::record_action(&mut policy_obj, b"scallop", 75, walrus_blob(), &clock, test::ctx(&mut scenario));

        policy::destroy_for_testing(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 6, location = nexus_agent_wallet::policy)]
    fun paused_policy_rejects_actions() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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

    #[test, expected_failure(abort_code = 7, location = nexus_agent_wallet::policy)]
    fun revoked_policy_rejects_actions() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
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
        policy::create_policy(
            AGENT,
            150,
            100,
            protocols(),
            31_000,
            mint_deposit(&mut scenario, 150),
            &clock,
            test::ctx(&mut scenario),
        );

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
