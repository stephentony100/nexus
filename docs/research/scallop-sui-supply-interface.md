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

## Move Dependency Probe

Probe package:

- Path: `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\scallop_move_probe`
- Sui CLI: `sui 1.70.2-6d4ec0b0621d-dirty`
- Sui executable: `C:\Users\NT\bin\sui.exe`
- Sui executable SHA-256: `7BEC7E9D4FED878491A28952AD03C765293A6B7010A88197DBDE9B21CAE8C31F`

Inspected protocol repository:

- URL: `https://github.com/scallop-io/sui-lending-protocol.git`
- Exact commit: `334e93a1232a1d9417466080ae24491be3f7b27c`
- Commit command: `git -c safe.directory='C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol' -c core.excludesFile= -C 'C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol' rev-parse HEAD`

Exact `Move.toml` paths found:

- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\libs\coin_decimals_registry\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\libs\decimal\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\libs\math\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\libs\whitelist\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\libs\x\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\protocol\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\protocol_whitelist\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\query\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\custom_afsui_rule\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\custom_hasui_rule\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\pyth_rule\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\pyth_rule\vendors\pyth\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\pyth_rule\vendors\wormhole\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\supra_rule\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\supra_rule\vendors\supra_oracle\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\switchboard_on_demand_rule\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\switchboard_rule\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\switchboard_rule\vendors\switchboard_std\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\switchboard_rule\vendors\switchboard_std_test\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\sui_x_oracle\x_oracle\Move.toml`
- `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\sui-lending-protocol\contracts\test_coin\Move.toml`

Consumable package and source layout:

- Manifest: `contracts/protocol/Move.toml`
- Manifest package name: `ScallopProtocol`
- Named address: `protocol = "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf"`
- Published-at address: `0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805`
- `mint`: `protocol::mint::mint` in `contracts/protocol/sources/user/mint.move`
- `Market`: `protocol::market::Market` in `contracts/protocol/sources/market/market.move`
- `Version`: `protocol::version::Version` in `contracts/protocol/sources/version/version.move`
- `MarketCoin`: `protocol::reserve::MarketCoin` in `contracts/protocol/sources/market/reserve.move`

Current mainnet compatibility checks:

- Current documented call package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`.
- A `sui_getObject` mainnet RPC query confirmed that the current package contains the `mint` module.
- The same query reported these type origins:
  - `protocol::market::Market`: `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf`
  - `protocol::reserve::MarketCoin`: `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf`
  - `protocol::version::Version`: `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf`
- A `sui_getNormalizedMoveFunction` mainnet RPC query for `0xa45b...::mint::mint` matched the documented/source signature: `&Version`, `&mut Market`, `Coin<T>`, `&Clock`, `&mut TxContext` -> `Coin<MarketCoin<T>>`.
- The cloned source therefore matches the current package's required type identities and function signature.
- The cloned manifest's `published-at` value is still `0xde5c...`, not the current documented package `0xa45b...`. A normal mainnet compile proves source/interface compatibility, but it does not by itself prove that publishing Nexus would link the adapter call to the current `0xa45b...` package. Production implementation must resolve this package-linkage metadata before deployment.

Dependency attempted:

```toml
[dependencies]
protocol = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = "contracts/protocol", rev = "334e93a1232a1d9417466080ae24491be3f7b27c" }
```

The current Sui CLI requires the dependency key `protocol`. The initial key `ScallopProtocol` failed before compilation with:

```text
In Move.toml, the dependency `ScallopProtocol` refers to a package named `protocol`.
Consider renaming the dependency to `protocol`.
```

Compile command:

```powershell
sui move build --path 'C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe\scallop_move_probe' --build-env mainnet --force
```

Compile result: **succeeded** (exit code 0).

Relevant output:

```text
INCLUDING DEPENDENCY CoinDecimalsRegistry
INCLUDING DEPENDENCY Decimal
INCLUDING DEPENDENCY Math
INCLUDING DEPENDENCY MoveStdlib
INCLUDING DEPENDENCY ScallopProtocol
INCLUDING DEPENDENCY Sui
INCLUDING DEPENDENCY Whitelist
INCLUDING DEPENDENCY X
INCLUDING DEPENDENCY XOracle
BUILDING scallop_move_probe
```

Import verification:

- `mint`: **verified** - `protocol::mint::mint<SUI>` was called by the compiled `supply_sui` probe.
- `Market`: **verified** - `protocol::market::Market` compiled in the concrete SUI probe function signature.
- `Version`: **verified** - `protocol::version::Version` compiled in the concrete SUI probe function signature.
- `MarketCoin`: **verified** - `protocol::reserve::MarketCoin` compiled in the `Coin<MarketCoin<SUI>>` return type.
