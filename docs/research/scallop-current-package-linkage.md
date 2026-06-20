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
