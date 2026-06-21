#[allow(duplicate_alias, lint(public_entry))]
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
