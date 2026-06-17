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
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);

        policy::create_policy(
            AGENT,
            500,
            100,
            protocols(),
            31_000,
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

        test::return_shared(policy_obj);
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 0)]
    fun create_policy_rejects_zero_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 0, 100, protocols(), 31_000, &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1)]
    fun create_policy_rejects_zero_single_tx_limit() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 0, protocols(), 31_000, &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 1)]
    fun create_policy_rejects_single_tx_limit_above_total_budget() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 501, protocols(), 31_000, &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 2)]
    fun create_policy_rejects_empty_protocol_list() {
        let mut scenario = test::begin(OWNER);
        let clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, vector[], 31_000, &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3)]
    fun create_policy_rejects_expiry_at_current_time() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(AGENT, 500, 100, protocols(), 1_000, &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test, expected_failure(abort_code = 3)]
    fun create_policy_rejects_expiry_before_current_time() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        clock::set_for_testing(&mut clock, 1_000);
        policy::create_policy(AGENT, 500, 100, protocols(), 999, &clock, test::ctx(&mut scenario));
        clock::destroy_for_testing(clock);
        test::end(scenario);
    }

    #[test]
    fun owner_can_pause_resume_and_revoke_policy() {
        let mut scenario = test::begin(OWNER);
        let mut clock = clock::create_for_testing(test::ctx(&mut scenario));
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(&mut scenario));

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
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(&mut scenario));

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
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(&mut scenario));

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
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(&mut scenario));

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
        policy::create_policy(AGENT, 500, 100, protocols(), 31_000, &clock, test::ctx(&mut scenario));

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
}
