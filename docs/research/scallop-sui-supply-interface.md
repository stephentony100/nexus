# Scallop SUI Supply Interface Research

## Purpose

Resolve the exact Scallop Move dependency/interface needed for Nexus to supply SUI from `PolicyObject.vault` into Scallop and custody the returned `MarketCoin<SUI>`.

## Verified Documentation Facts

Scallop lending supply is documented as:

```move
public fun mint<T>(
    version: &Version,
    market: &mut Market,
    coin: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<MarketCoin<T>>
```

For SUI supply:

- type argument: `0x2::sui::SUI`
- returned value: `Coin<MarketCoin<SUI>>`

Current Scallop docs list:

- protocol package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`
- version object: `0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7`
- market object: `0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9`

## Source Links

- Scallop docs: `https://docs.scallop.io/integrations/contract-integration/lending-function`
- Scallop package addresses: `https://docs.scallop.io/integrations/package-addresses`
- Scallop SDK repo: `https://github.com/scallop-io/sui-scallop-sdk`

## Git Repository Checks

### `scallop-io/sui-lending-protocol`

- Command: `git ls-remote https://github.com/scallop-io/sui-lending-protocol.git`
- Result: The repository is public and returned refs.
- Evidence: `334e93a1232a1d9417466080ae24491be3f7b27c	HEAD`

### `scallop-io/sui-scallop-sdk`

- Command: `git ls-remote https://github.com/scallop-io/sui-scallop-sdk.git`
- Result: The repository is public and returned refs.
- Evidence: `5417cc678d2774ce9fd142dc5140ce401913111d	HEAD`

### Move Package Search In SDK Repo

- Command: `Get-ChildItem ... -Filter Move.toml`
- Result: No Move.toml files found in the SDK repo clone.
