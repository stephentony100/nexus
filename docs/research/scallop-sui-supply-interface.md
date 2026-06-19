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

- Search root: `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-scallop-sdk`
- Checked SDK commit: `5417cc678d2774ce9fd142dc5140ce401913111d`
- Command: `Get-ChildItem -Path "C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-scallop-sdk" -Recurse -Filter Move.toml | Select-Object -ExpandProperty FullName`
- Result: No Move.toml files found in the SDK repo clone.
- Evidence: command completed with no output.

## NPM SDK Inspection

The TypeScript SDK exposes Scallop lending supply through builder methods such as `depositQuick` and `deposit`.

Observed source references:

- `document/builder.md:59` - builder docs note that `depositQuick` requires a sender before supply.
- `document/builder.md:61` - builder docs name the `depositQuick(10 ** 9, 'wusdc')` result `marketCoin`, but source behavior below shows `depositQuick` converts to sCoin by default.
- `document/builder.md:129` - builder docs show a SUI-specific `deposit(coin, 'sui')` call after splitting SUI from gas.
- `src/builders/coreBuilder.ts:139` - `deposit` derives the coin type from the pool coin name.
- `src/builders/coreBuilder.ts:144` - `deposit` calls `${coreIds.protocolPkg}::mint::mint`.
- `src/builders/coreBuilder.ts:145` - `deposit` passes PTB arguments in the order `[coreIds.version, coreIds.market, coin, clockObjectRef]`.
- `src/builders/coreBuilder.ts:335` - `depositQuick` is exposed as an async helper accepting `amount`, `poolCoinName`, and optional `returnSCoin`.
- `src/builders/coreBuilder.ts:338` - `depositQuick` handles the SUI path by splitting SUI from gas before calling `txBlock.deposit`.
- `src/builders/coreBuilder.ts:352` - `depositQuick` converts the returned market coin to sCoin by default, or returns the market coin when `returnSCoin` is false.
- `src/builders/coreBuilder.ts:70` - core builder resolves the market object from `builder.address.get('core.market')`.
- `src/builders/coreBuilder.ts:71` - core builder resolves the version object from `builder.address.get('core.version')`.

SDK clone:

- commit: `5417cc678d2774ce9fd142dc5140ce401913111d`

Package metadata:

- package name: `@scallop-io/sui-scallop-sdk`
- version: `2.2.0`

SDK implication for Nexus:

- ActionFlow can later use the SDK's address lookup keys and PTB argument order validated here; concrete object IDs still come from Scallop package-address docs/config.
- The SDK alone does not solve Move-side `MarketCoin<SUI>` type coupling inside `PolicyObject`.
