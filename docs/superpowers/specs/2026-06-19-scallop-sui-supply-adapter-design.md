# Nexus Scallop SUI Supply Adapter Design

## Source Of Truth

This design follows `Nexus.md` and builds on `docs/superpowers/specs/2026-06-19-custody-vault-design.md`.

Nexus now has a SUI custody vault inside `PolicyObject`. The next narrow step is a Scallop-only adapter that lets the approved agent supply SUI from that vault into Scallop lending while keeping the resulting position under policy custody.

## External Interface References

Scallop's public documentation describes the lending supply function as:

```move
public fun mint<T>(
    version: &Version,
    market: &mut Market,
    coin: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<MarketCoin<T>>
```

For SUI supply, the type argument is `0x2::sui::SUI`, and Scallop returns `Coin<MarketCoin<SUI>>`.

Current Scallop docs list these mainnet integration values:

- protocol package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`
- version object: `0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7`
- market object: `0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9`

These object IDs are not hardcoded into the Nexus Move module. They are PTB inputs supplied by ActionFlow later.

## Scope

Build a supply-only Scallop SUI adapter.

The adapter:

- moves SUI from `PolicyObject.vault`
- enforces all Nexus policy limits on-chain
- calls Scallop `mint<SUI>`
- stores the returned Scallop market coin position in the `PolicyObject`
- updates `spent_total`
- emits adapter audit events

This phase does not implement Scallop redeem, DeepBook, generic adapters, oracle valuation, APY/risk decisions, Walrus storage, daemon scheduling, or frontend/API work.

## Goals

- Add real agent-facing fund movement for one protocol path: SUI supply into Scallop lending.
- Keep the safety boundary on-chain: policy validation, vault debit, Scallop supply, position custody, and accounting happen atomically in one Move entry function.
- Keep returned `Coin<MarketCoin<SUI>>` under policy custody, not owner or agent custody.
- Preserve existing owner withdrawal behavior for idle vault SUI.
- Preserve existing `record_action` signature and public behavior.
- Prepare ActionFlow and PolicyLoop for a later PTB update without changing them in this design phase.

## Non-Goals

- Redeeming Scallop market coins back into SUI.
- Transferring Scallop market coins to the owner or agent.
- Supporting any asset besides SUI.
- Supporting Scallop borrow/collateral/obligation flows.
- Supporting DeepBook.
- Using an off-chain-only PTB flow as the safety boundary.
- Real Walrus writes; `walrus_blob_id` remains an opaque audit reference.
- Market data or AI decision making.

## Architecture

### Existing Module

`nexus_agent_wallet::policy` remains the owner of `PolicyObject`.

It gains:

- Scallop SUI position storage.
- Internal/package-visible helpers for the adapter to perform safe agent action accounting.
- Read-only position balance accessors.

### New Module

Add `nexus_agent_wallet::scallop_adapter`.

This module imports Scallop protocol types and exposes one public entry function: `supply_sui`.

The adapter does not duplicate policy logic. It calls policy-owned helper functions for checks, vault debit, position custody, and accounting.

## Scallop Dependency Strategy

`PolicyObject` must store `Balance<MarketCoin<SUI>>`, which couples Nexus to Scallop's `MarketCoin` type. Implementation must first resolve the real Move dependency path for Scallop protocol.

Accepted implementation paths, in priority order:

1. Use the official Scallop protocol Move package dependency if it is published in a consumable Git path.
2. Use a minimal local Scallop interface package only if Sui Move supports linking the on-chain package address and type definitions cleanly for compilation.
3. If neither is practical, stop before production code and revise the design to a TypeScript-only proof-of-integration. This fallback is not the desired architecture; it is only a blocker response.

The implementation plan must include a dependency spike before production adapter code.

## Data Model

`PolicyObject` gains:

```move
scallop_sui_position: Balance<MarketCoin<SUI>>
```

This stores the Scallop market coin balance returned by supplying SUI.

The value is not a SUI valuation. It is position-token accounting. Future redeem/valuation phases will interpret it.

New read helper:

```move
public fun scallop_sui_position_balance(policy: &PolicyObject): u64
```

## Public API

### `supply_sui`

Module: `nexus_agent_wallet::scallop_adapter`

```move
public entry fun supply_sui(
    policy: &mut PolicyObject,
    amount: u64,
    walrus_blob_id: vector<u8>,
    scallop_version: &ScallopVersion,
    scallop_market: &mut ScallopMarket,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

Validation:

- caller must be `policy.agent`
- policy must not be paused
- policy must not be revoked
- policy must not be expired
- `b"scallop"` must be in `allowed_protocols`
- `amount > 0`
- `amount <= max_single_tx`
- `amount <= max_total_budget - spent_total`
- `amount <= vault_balance`

Effects:

1. Split `amount` from `policy.vault`.
2. Convert the split `Balance<SUI>` to `Coin<SUI>`.
3. Call Scallop:

   ```move
   scallop_protocol::mint::mint<SUI>(
       scallop_version,
       scallop_market,
       coin,
       clock,
       ctx,
   )
   ```

4. Convert returned `Coin<MarketCoin<SUI>>` into `Balance<MarketCoin<SUI>>`.
5. Join the returned balance into `policy.scallop_sui_position`.
6. Increment `spent_total`.
7. Emit `ScallopSuiSupplied`.

The function is atomic: if Scallop mint fails, all policy state changes roll back.

## Internal Policy Helpers

The adapter needs safe access to policy-owned state without exposing generic vault extraction.

`policy` should expose helpers usable by `scallop_adapter`, scoped as narrowly as Move allows:

- validate an agent action for a protocol and amount
- debit SUI from the vault after validation
- join Scallop SUI market coin position into policy custody
- increment `spent_total`

The helper API must not allow arbitrary callers to drain the vault or mutate `spent_total` without the adapter's validation flow.

If Move visibility cannot express the desired narrow boundary cleanly, keep the adapter function in `policy.move` instead of a separate module. The preferred design is a separate module, but safety is more important than file separation.

## Events

Add:

```move
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
```

This event is the adapter-specific audit event for the supply operation.

Existing events stay unchanged:

- `PolicyCreated`
- `PolicyPaused`
- `PolicyResumed`
- `PolicyRevoked`
- `ActionRecorded`
- `FundsWithdrawn`

`record_action` remains available for generic bookkeeping, but Scallop supply uses `ScallopSuiSupplied` because it both moves funds and records the protocol-specific position.

## Error Handling

Reuse existing abort codes where possible:

- `ENotAgent`
- `EPolicyPaused`
- `EPolicyRevoked`
- `EPolicyExpired`
- `EProtocolNotAllowed`
- `EZeroAmount`
- `ESingleTxLimitExceeded`
- `ETotalBudgetExceeded`
- `EInsufficientVaultBalance`

Add new adapter-specific abort codes only if needed for dependency or state-shape failures. Scallop protocol aborts are allowed to bubble up unchanged because they identify failures inside Scallop's own market rules.

## TypeScript Impact

No TypeScript code changes in the first Move-only implementation task.

After the Move adapter compiles and tests pass, a separate ActionFlow design/plan should update PTB generation to call:

```text
nexus_agent_wallet::scallop_adapter::supply_sui
```

instead of `policy::record_action` for `protocol === "scallop"` and `action === supply/deposit`.

That later ActionFlow task must pass:

- policy shared object
- amount
- Walrus blob ID
- Scallop version object
- Scallop market object
- Clock object

## Testing

Move tests must cover Nexus-side behavior:

- approved agent can supply SUI to Scallop
- wrong caller is rejected
- paused policy is rejected
- revoked policy is rejected
- expired policy is rejected
- policy without `b"scallop"` in `allowed_protocols` is rejected
- zero amount is rejected
- amount above `max_single_tx` is rejected
- amount above remaining budget is rejected
- amount above vault balance is rejected
- successful supply reduces `vault_balance`
- successful supply increments `spent_total`
- successful supply increases `scallop_sui_position_balance`
- owner withdrawal can still withdraw remaining idle SUI after a partial Scallop supply

Testing Scallop integration may require a test-only mock module if the real Scallop package cannot be used in local Move unit tests. The mock must mimic only the needed shape:

- accept `Coin<SUI>`
- return `Coin<MarketCoin<SUI>>`
- preserve the input value for balance assertions

The implementation plan must choose the test strategy after the dependency spike.

## Security Notes

- Never expose a generic agent withdrawal from the vault.
- Budget accounting and vault debit must be one atomic path.
- `spent_total` must update only after Scallop mint succeeds, in the same atomic transaction path.
- Returned Scallop market coins must stay policy-custodied.
- Owner withdrawal should continue to affect only idle SUI in the vault, not Scallop positions.
- A failed Scallop mint must not debit vault, increment `spent_total`, or change position balance.

## Later Extensions

- Scallop redeem from `MarketCoin<SUI>` back to SUI.
- Scallop position valuation.
- APY/risk-aware PolicyLoop decisions.
- ActionFlow PTB generation for Scallop supply.
- DeepBook adapter.
- Generic adapter interface if the second real protocol proves the abstraction.
