# Scallop Current-Package Linkage Evidence

## Scope

Verify immutable dependency linkage to the current Scallop package. No production Nexus changes.

## Mainnet Package Evidence

RPC endpoint: `https://fullnode.mainnet.sui.io:443`

Current call package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`

`sui_getObject` was called with `showBcs=true`.

has_mint_module=True

market::Market origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

reserve::MarketCoin origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

version::Version origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf

Complete `sui_getNormalizedMoveFunction` response for module `mint`, function `mint`:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "visibility": "Public",
    "isEntry": false,
    "typeParameters": [
      {
        "abilities": []
      }
    ],
    "parameters": [
      {
        "Reference": {
          "Struct": {
            "address": "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf",
            "module": "version",
            "name": "Version",
            "typeArguments": []
          }
        }
      },
      {
        "MutableReference": {
          "Struct": {
            "address": "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf",
            "module": "market",
            "name": "Market",
            "typeArguments": []
          }
        }
      },
      {
        "Struct": {
          "address": "0x2",
          "module": "coin",
          "name": "Coin",
          "typeArguments": [
            {
              "TypeParameter": 0
            }
          ]
        }
      },
      {
        "Reference": {
          "Struct": {
            "address": "0x2",
            "module": "clock",
            "name": "Clock",
            "typeArguments": []
          }
        }
      },
      {
        "MutableReference": {
          "Struct": {
            "address": "0x2",
            "module": "tx_context",
            "name": "TxContext",
            "typeArguments": []
          }
        }
      }
    ],
    "return": [
      {
        "Struct": {
          "address": "0x2",
          "module": "coin",
          "name": "Coin",
          "typeArguments": [
            {
              "Struct": {
                "address": "0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf",
                "module": "reserve",
                "name": "MarketCoin",
                "typeArguments": [
                  {
                    "TypeParameter": 0
                  }
                ]
              }
            }
          ]
        }
      }
    ]
  }
}
```

## Official Manifest Search

Official repository: `https://github.com/scallop-io/sui-lending-protocol.git`

Search scope: all fetched branches, commits, and tags after a full clone and `git fetch --all --tags --prune`. The fetched repository contained 54 refs (47 local/remote branch refs and 7 tags), 794 unique commits reachable from all refs, and 39 unique commits touching either `contracts/protocol/Move.toml` or `contracts/protocol/Move.mainnet.toml`.

Exact result: `OFFICIAL_MATCH`

Matching SHA:

- `2425b5b8b107bda10f4fa04517eb3cc009817249` (`chore: update package id`)

Selected immutable official SHA: `2425b5b8b107bda10f4fa04517eb3cc009817249`

At that commit, exact fixed-string matches occur in both manifests:

```text
2425b5b8b107bda10f4fa04517eb3cc009817249:contracts/protocol/Move.mainnet.toml:4:published-at = "0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a"
2425b5b8b107bda10f4fa04517eb3cc009817249:contracts/protocol/Move.toml:4:published-at = "0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a"
```

Command evidence and count-to-output mapping:

```powershell
$root = Join-Path $env:TEMP 'nexus-scallop-linkage'
$repo = Join-Path $root 'sui-lending-protocol'
New-Item -ItemType Directory -Path $root -Force | Out-Null
if (Test-Path -LiteralPath $repo) {
  $resolvedRoot = (Resolve-Path -LiteralPath $root).Path
  $resolved = (Resolve-Path -LiteralPath $repo).Path
  $rootPrefix = $resolvedRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove '$resolved': it is not within '$resolvedRoot'."
  }
  Remove-Item -Recurse -Force -LiteralPath $resolved
}
git clone https://github.com/scallop-io/sui-lending-protocol.git $repo
git -C $repo fetch --all --tags --prune

$refs = @(git -C $repo for-each-ref --format='%(refname)')
$branchRefs = @($refs | Where-Object { $_ -like 'refs/heads/*' -or $_ -like 'refs/remotes/*' })
$tagRefs = @($refs | Where-Object { $_ -like 'refs/tags/*' })
$allCommits = @(git -C $repo rev-list --all)
$manifestCommits = @(git -C $repo log --all --format='%H' -- contracts/protocol/Move.toml contracts/protocol/Move.mainnet.toml | Sort-Object -Unique)

[pscustomobject]@{
  TotalRefs = $refs.Count
  BranchRefs = $branchRefs.Count
  Tags = $tagRefs.Count
  UniqueCommits = $allCommits.Count
  ManifestTouchingCommits = $manifestCommits.Count
}

# Output:
# TotalRefs BranchRefs Tags UniqueCommits ManifestTouchingCommits
# --------- ---------- ---- ------------- -----------------------
#        54         47    7           794                      39

foreach ($sha in $manifestCommits) { git -C $repo grep -n -F '0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a' $sha -- contracts/protocol/Move.toml contracts/protocol/Move.mainnet.toml }
```

## Dependency Selection

- source: official Scallop repository
- repository: `https://github.com/scallop-io/sui-lending-protocol.git`
- subdirectory: `contracts/protocol`
- selected commit: `2425b5b8b107bda10f4fa04517eb3cc009817249`
- selected commit is immutable: yes
- fork used: no
- official manifest already targets current package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`
- fallback repository created: no

Source-equivalence scope: this is official source, so no fork diff is needed; later probe/linkage tasks still must verify compilation and resolved dependency IDs.

## Concrete Move Probe

- repository: `https://github.com/scallop-io/sui-lending-protocol.git`
- subdirectory: `contracts/protocol`
- immutable revision: `2425b5b8b107bda10f4fa04517eb3cc009817249`
- build environment: `mainnet`

Exact probe `Move.toml`:

```toml
[package]
name = "scallop_linkage_probe"
edition = "2024.beta"

[dependencies]
protocol = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = "contracts/protocol", rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }

[addresses]
scallop_linkage_probe = "0x0"
```

Resolved `Move.lock` pin for `ScallopProtocol`:

```toml
[pinned.mainnet.ScallopProtocol]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\protocol', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "08503294DDA2C6B947453F99A652633B5F9449D226019A80216E04DEFC406CA8"
deps = { CoinDecimalsRegistry = "CoinDecimalsRegistry", Math = "Math", Sui = "Sui_1", Whitelist = "Whitelist", X = "X", XOracle = "XOracle" }
```

Exact probe source:

```move
module scallop_linkage_probe::probe;

use protocol::market::Market;
use protocol::mint;
use protocol::reserve::MarketCoin;
use protocol::version::Version;
use sui::balance::Balance;
use sui::clock::Clock;
use sui::coin::Coin;
use sui::sui::SUI;

public struct PositionProbe has store {
    position: Balance<MarketCoin<SUI>>,
}

public fun supply_probe(
    version: &Version,
    market: &mut Market,
    coin: Coin<SUI>,
    clock: &Clock,
    ctx: &mut sui::tx_context::TxContext,
): Coin<MarketCoin<SUI>> {
    mint::mint<SUI>(version, market, coin, clock, ctx)
}
```

Build command:

```powershell
$probe = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe'
sui move build --path $probe --build-env mainnet
```

Complete build output (terminal color escape sequences omitted):

```text
Downloading from https://github.com/scallop-io/sui-lending-protocol.git
INCLUDING DEPENDENCY CoinDecimalsRegistry
INCLUDING DEPENDENCY Math
INCLUDING DEPENDENCY MoveStdlib
INCLUDING DEPENDENCY ScallopProtocol
INCLUDING DEPENDENCY Sui
INCLUDING DEPENDENCY Whitelist
INCLUDING DEPENDENCY X
INCLUDING DEPENDENCY XOracle
BUILDING scallop_linkage_probe
warning[W09009]: unused struct field
   +- .\sources\probe.move:13:5
   |
13 |     position: Balance<MarketCoin<SUI>>,
   |     ^^^^^^^^ The 'position' field of the 'PositionProbe' type is unused
   |
   = This warning can be suppressed with '#[allow(unused_field)]' applied to the 'module' or module member ('const', 'fun', or 'struct')
```

`mint<SUI> result: compiled`

`Balance<MarketCoin<SUI>> result: compiled`

`build result: succeeded`

## Publication Linkage

Exact command:

```powershell
sui move build --path $env:TEMP\nexus-scallop-linkage\scallop_linkage_probe --build-env mainnet --dump-bytecode-as-base64 --no-tree-shaking --quiet
```

- timeout: 180 seconds
- expected current package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`
- rejected old package: `0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805`
- command result: timeout; the remaining command process was terminated and a subsequent process check found no surviving `sui` process
- package assertions: not run because the command did not exit 0 with usable publication metadata
- captured output file: `%TEMP%\nexus-scallop-linkage\publish-metadata.txt`

Relevant captured dependency output:

```text
Error while loading dependency C:\Users\CodexSandboxOffline\.move\git\https___github_com_scallop-io_sui-lending-protocol_git_2425b5b8b107bda10f4fa04517eb3cc009817249\contracts\libs\coin_decimals_registry: Error while fetching `{ git = "https://...protocol.git", path = "contracts\libs\coin_decimals_registry", rev = "2425b5...49" }`: error while executing git command `Command { std: "git" "-c" "advice.detachedHead=false" "clone" "--quiet" "--sparse" "--filter=blob:none" "--no-checkout" "--depth" "1" "--" "https://github.com/scallop-io/sui-lending-protocol.git" "C:\\Users\\CodexSandboxOffline\\.move\\git\\https___github_com_scallop-io_sui-lending-protocol_git_2425b5b8b107bda10f4fa04517eb3cc009817249", kill_on_drop: false }`:
ErrorCode(ExitStatus(ExitStatus(128)))

Downloading from https://github.com/scallop-io/sui-lending-protocol.git
output from `git -c advice.detachedHead=false clone --quiet --sparse --filter=blob:none --no-checkout --depth 1 -- https://github.com/scallop-io/sui-lending-protocol.git C:\Users\CodexSandboxOffline\.move\git\https___github_com_scallop-io_sui-lending-protocol_git_2425b5b8b107bda10f4fa04517eb3cc009817249`
  fatal: unable to access 'https://github.com/scallop-io/sui-lending-protocol.git/': Failed to connect to github.com port 443 after 334 ms: Could not connect to server
```

`REVISE: PUBLICATION_LINKAGE_VERIFICATION_FAILED`

Controller escalated retry command (approved network escalation):

```powershell
$probe = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe'; sui move build --path $probe --build-env mainnet --dump-bytecode-as-base64 --no-tree-shaking --quiet
```

- retry window: strict 180 seconds
- retry output: no usable output was emitted
- retry result: the command was terminated at the 180-second limit
- `CURRENT_SCALLOP_DEPENDENCY_RESOLVED`: not obtained

Reason: the original sandbox attempt produced the dependency-fetch network failure captured above. The controller then reran the exact publication command with approved network escalation, but it emitted no usable output and was terminated at the strict 180-second limit. Therefore neither presence of the current package ID nor absence of the old package ID was established, and success is not inferred.

Task 6 requirement remains `REVISE`: publication linkage must be verified before proceeding.
