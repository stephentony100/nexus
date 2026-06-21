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

### Complete Reproducible Lock Evidence

Exact probe `Move.lock` SHA-256: `352D50659A4CBDB2730A0CE7B2AD3601D1E2A55A2D79A8F96CEA6D5D87768B8C`

The complete generated lockfile is:

```toml
# Generated by move; do not edit
# This file should be checked in.

[move]
version = 4

[pinned.mainnet.CoinDecimalsRegistry]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\libs\coin_decimals_registry', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "3876920E3F5449B657525E749B996C31141507452514AF2E259F5441554DCDDF"
deps = { Sui = "Sui_1" }

[pinned.mainnet.Math]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\libs\math', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "3876920E3F5449B657525E749B996C31141507452514AF2E259F5441554DCDDF"
deps = { Sui = "Sui_1" }

[pinned.mainnet.MoveStdlib]
source = { git = "https://github.com/MystenLabs/sui.git", subdir = 'crates\sui-framework\packages\move-stdlib', rev = "367fd808279bed26f7c64fc63160062a2ee29ab7" }
use_environment = "mainnet"
manifest_digest = "C4FE4C91DE74CBF223B2E380AE40F592177D21870DC2D7EB6227D2D694E05363"
deps = {}

[pinned.mainnet.MoveStdlib_1]
source = { git = "https://github.com/MystenLabs/sui.git", subdir = 'crates\sui-framework\packages\move-stdlib', rev = "1f6e1e6dd72dc75ac4037b3d4e38e73b133c5ef6" }
use_environment = "mainnet"
manifest_digest = "C4FE4C91DE74CBF223B2E380AE40F592177D21870DC2D7EB6227D2D694E05363"
deps = {}

[pinned.mainnet.ScallopProtocol]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\protocol', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "08503294DDA2C6B947453F99A652633B5F9449D226019A80216E04DEFC406CA8"
deps = { CoinDecimalsRegistry = "CoinDecimalsRegistry", Math = "Math", Sui = "Sui_1", Whitelist = "Whitelist", X = "X", XOracle = "XOracle" }

[pinned.mainnet.Sui]
source = { git = "https://github.com/MystenLabs/sui.git", subdir = 'crates\sui-framework\packages\sui-framework', rev = "367fd808279bed26f7c64fc63160062a2ee29ab7" }
use_environment = "mainnet"
manifest_digest = "CD547CB1ACCE0880C835DAED2D8FFCB91D56C833AE5240D3AA5B918398263195"
deps = { MoveStdlib = "MoveStdlib" }

[pinned.mainnet.Sui_1]
source = { git = "https://github.com/MystenLabs/sui.git", subdir = 'crates\sui-framework\packages\sui-framework', rev = "1f6e1e6dd72dc75ac4037b3d4e38e73b133c5ef6" }
use_environment = "mainnet"
manifest_digest = "CD547CB1ACCE0880C835DAED2D8FFCB91D56C833AE5240D3AA5B918398263195"
deps = { MoveStdlib = "MoveStdlib_1" }

[pinned.mainnet.Whitelist]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\libs\whitelist', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "3876920E3F5449B657525E749B996C31141507452514AF2E259F5441554DCDDF"
deps = { Sui = "Sui_1" }

[pinned.mainnet.X]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\libs\x', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "3876920E3F5449B657525E749B996C31141507452514AF2E259F5441554DCDDF"
deps = { Sui = "Sui_1" }

[pinned.mainnet.XOracle]
source = { git = "https://github.com/scallop-io/sui-lending-protocol.git", subdir = 'contracts\sui_x_oracle\x_oracle', rev = "2425b5b8b107bda10f4fa04517eb3cc009817249" }
use_environment = "mainnet"
manifest_digest = "3876920E3F5449B657525E749B996C31141507452514AF2E259F5441554DCDDF"
deps = { Sui = "Sui_1" }

[pinned.mainnet.scallop_linkage_probe]
source = { root = true }
use_environment = "mainnet"
manifest_digest = "46C72BBF5DA0533B645F68A6DF8B5904FA37F943EDB0B4C8A9A4FB2A0D9D05C0"
deps = { protocol = "ScallopProtocol", std = "MoveStdlib", sui = "Sui" }
```

The exact transitive Sui/MoveStdlib revisions are `367fd808279bed26f7c64fc63160062a2ee29ab7` and `1f6e1e6dd72dc75ac4037b3d4e38e73b133c5ef6`. Every `pinned.mainnet` git source uses a 40-character immutable SHA; no lock entry uses `mainnet` or another floating branch as its `rev` value.

The Scallop source manifest declares Sui with `rev = "mainnet"`, but the generated committed evidence resolves that declaration to the immutable lock SHAs above. The production adapter must check in its generated `Move.lock` with equivalent immutable pins.

Programmatic lock verification command and result:

```powershell
$lock = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe\Move.lock'
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $lock).Hash
$content = [System.IO.File]::ReadAllText($lock)
$revLines = @($content.Split([char]10) | Where-Object { $_.Contains('rev = ') })
$revs = @($revLines | ForEach-Object { $rest = $_.Substring($_.IndexOf('rev = ') + 7); $rest.Substring(0, $rest.IndexOf([char]34)) })
$invalid = @($revs | Where-Object { $_ -cnotmatch '^[0-9a-f]{40}$' -or $_ -ceq 'mainnet' })
if ($hash -cne '352D50659A4CBDB2730A0CE7B2AD3601D1E2A55A2D79A8F96CEA6D5D87768B8C') { throw 'Unexpected Move.lock SHA-256' }
if ($invalid.Count -ne 0) { throw "Mutable or invalid revisions: $($invalid -join ',')" }
'IMMUTABLE_TRANSITIVE_LOCK_VERIFIED'
```

```text
IMMUTABLE_TRANSITIVE_LOCK_VERIFIED
```

## Publication Linkage

Publication metadata command:

```cmd
C:\Users\NT\bin\sui.exe move build --path "%TEMP%\nexus-scallop-linkage\scallop_linkage_probe" --build-env mainnet --dump-bytecode-as-base64 --no-tree-shaking --quiet
```

Exact `%TEMP%\nexus-scallop-linkage\run-publication.cmd` content:

```bat
@echo off
"C:\Users\NT\bin\sui.exe" move build --path "%TEMP%\nexus-scallop-linkage\scallop_linkage_probe" --build-env mainnet --dump-bytecode-as-base64 --no-tree-shaking --quiet > "%TEMP%\nexus-scallop-linkage\publication-wrapper-output.txt" 2>&1
exit /b %ERRORLEVEL%
```

Exact parent PowerShell invocation:

```powershell
$root = Join-Path $env:TEMP 'nexus-scallop-linkage'
$script = Join-Path $root 'run-publication.cmd'
$output = Join-Path $root 'publication-wrapper-output.txt'
Remove-Item -LiteralPath $output -Force -ErrorAction SilentlyContinue
$process = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d','/c',$script) -WindowStyle Hidden -PassThru
$completed = $process.WaitForExit(180000)
if (-not $completed) {
    & taskkill.exe /PID $process.Id /T /F | Out-Null
    'WRAPPER_RESULT=TIMEOUT_180_SECONDS'
} else {
    "WRAPPER_RESULT=EXIT_$($process.ExitCode)"
}
if (Test-Path $output) { Get-Content -Raw $output }
```

- timeout: 180 seconds
- expected current package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`
- rejected old package: `0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805`
- wrapper script: `%TEMP%\nexus-scallop-linkage\run-publication.cmd`
- captured output file: `%TEMP%\nexus-scallop-linkage\publication-wrapper-output.txt`
- wrapper mechanism: the script invokes the exact command above and redirects stdout and stderr to the captured output file; the parent starts hidden `cmd.exe`, calls `WaitForExit(180000)`, and kills the process tree only if the timeout expires
- definitive command result: `WRAPPER_RESULT=EXIT_0`

Exact JSON dependency array from the successful captured output:

```json
[
  "0xca5a5a62f01c79a104bf4d31669e29daa387f325c241de4edbe30986a9bc8b0d",
  "0xad013d5fde39e15eabda32b3dbdafd67dac32b798ce63237c27a8f73339b9b6f",
  "0x0000000000000000000000000000000000000000000000000000000000000001",
  "0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a",
  "0x0000000000000000000000000000000000000000000000000000000000000002",
  "0x1318fdc90319ec9c24df1456d960a447521b0a658316155895014a6e39b5482f",
  "0x779b5c547976899f5474f3a5bc0db36ddf4697ad7e5a901db0415c2281d28162",
  "0x1478a432123e4b3d61878b629f2c692969fdb375644f1251cd278a4b1e7d7cd6"
]
```

- current target package `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`: present
- old package `0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805`: absent

Attempt history:

- The original sandbox attempt exited nonzero after dependency fetching failed because the sandbox could not connect to GitHub. Its captured network error remains useful diagnostic evidence, but it did not test publication linkage successfully.

  ```text
  Error while loading dependency C:\Users\CodexSandboxOffline\.move\git\https___github_com_scallop-io_sui-lending-protocol_git_2425b5b8b107bda10f4fa04517eb3cc009817249\contracts\libs\coin_decimals_registry: Error while fetching `{ git = "https://...protocol.git", path = "contracts\libs\coin_decimals_registry", rev = "2425b5...49" }`: error while executing git command `Command { std: "git" "-c" "advice.detachedHead=false" "clone" "--quiet" "--sparse" "--filter=blob:none" "--no-checkout" "--depth" "1" "--" "https://github.com/scallop-io/sui-lending-protocol.git" "C:\\Users\\CodexSandboxOffline\\.move\\git\\https___github_com_scallop-io_sui-lending-protocol_git_2425b5b8b107bda10f4fa04517eb3cc009817249", kill_on_drop: false }`:
  ErrorCode(ExitStatus(ExitStatus(128)))

  Downloading from https://github.com/scallop-io/sui-lending-protocol.git
  output from `git -c advice.detachedHead=false clone --quiet --sparse --filter=blob:none --no-checkout --depth 1 -- https://github.com/scallop-io/sui-lending-protocol.git C:\Users\CodexSandboxOffline\.move\git\https___github_com_scallop-io_sui-lending-protocol_git_2425b5b8b107bda10f4fa04517eb3cc009817249`
    fatal: unable to access 'https://github.com/scallop-io/sui-lending-protocol.git/': Failed to connect to github.com port 443 after 334 ms: Could not connect to server
  ```

- The earlier approved external retry emitted no usable output before an externally enforced 180-second timeout and was terminated. That timeout records the behavior of that invocation mechanism, not a publication-linkage failure.

  ```powershell
  $probe = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe'; sui move build --path $probe --build-env mainnet --dump-bytecode-as-base64 --no-tree-shaking --quiet
  ```

- The deterministic wrapper invocation above subsequently exited 0 within the same timeout and emitted usable JSON publication metadata. This definitive result supersedes the inconclusive earlier attempts.

`CURRENT_SCALLOP_DEPENDENCY_RESOLVED`

## Decision

Status: GO

- repository: `https://github.com/scallop-io/sui-lending-protocol.git`
- subdirectory: `contracts/protocol`
- immutable commit: `2425b5b8b107bda10f4fa04517eb3cc009817249`
- call package: `0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a`
- type origin: `0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf`
- official source selected, no fork created
- source equivalence: official source; no fork diff required
- provenance verified
- `mint<SUI>` compiled
- `Balance<MarketCoin<SUI>>` compiled
- build result: succeeded
- publication linkage verified/current dependency resolved
- next phase: supply-only `nexus_agent_wallet::scallop_adapter` implementation

## Verification

`sui move test` in `nexus_agent_wallet`: `Test result: OK. Total tests: 33; passed: 33; failed: 0`
