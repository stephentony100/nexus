# Scallop Current-Package Linkage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Produce and verify an immutable Scallop Move dependency whose official source and type identities are preserved while Nexus publication metadata resolves to current mainnet package 0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a.

**Architecture:** Search official Scallop history first. If no official current manifest exists, create a metadata-only fork from verified official commit 334e93a..., prove only approved deployment metadata changed, and pin the probe to the fork commit SHA. A concrete Move probe must compile mint<SUI> and Balance<MarketCoin<SUI>>, and publication metadata must explicitly resolve to 0xa45b... before GO.

**Tech Stack:** Sui Move 2024, Sui CLI, Sui mainnet JSON-RPC, Git, GitHub REST API, PowerShell.

---

## File Structure

- Create: docs/research/scallop-current-package-linkage.md
  - Records provenance, RPC, source diff, build, resolved dependency IDs, and final decision.
- Temporary: %TEMP%\nexus-scallop-linkage\sui-lending-protocol
  - Full official clone for history search and fallback commit.
- Temporary: %TEMP%\nexus-scallop-linkage\scallop_linkage_probe
  - Concrete Move probe; never committed.
- External fallback: https://github.com/stephentony100/sui-lending-protocol-nexus
  - Created only if official history has no current manifest.

Do not modify nexus_agent_wallet, ActionFlow, AgentRunner, IntentFlow, PolicyLoop, or any production file.

## Fixed Values

- Official repository: https://github.com/scallop-io/sui-lending-protocol.git
- Official baseline: 334e93a1232a1d9417466080ae24491be3f7b27c
- Protocol subdirectory: contracts/protocol
- Current package: 0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a
- Type origin: 0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf
- Older package: 0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805
- Fallback branch: nexus-current-mainnet-package

---

### Task 1: Record Mainnet Type And Interface Evidence

**Files:**
- Create: docs/research/scallop-current-package-linkage.md

- [ ] **Step 1: Query current package evidence**

Run:

~~~powershell
$package = '0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a'
$rpc = 'https://fullnode.mainnet.sui.io:443'
$objectBody = @{
    jsonrpc = '2.0'; id = 1; method = 'sui_getObject'
    params = @($package, @{ showBcs = $true })
} | ConvertTo-Json -Depth 10
$object = Invoke-RestMethod -Uri $rpc -Method Post -ContentType 'application/json' -Body $objectBody
$bcs = $object.result.data.bcs
$origins = $bcs.typeOriginTable | Where-Object {
    ($_.module_name -eq 'reserve' -and $_.datatype_name -eq 'MarketCoin') -or
    ($_.module_name -eq 'market' -and $_.datatype_name -eq 'Market') -or
    ($_.module_name -eq 'version' -and $_.datatype_name -eq 'Version')
} | Sort-Object module_name, datatype_name
$functionBody = @{
    jsonrpc = '2.0'; id = 2; method = 'sui_getNormalizedMoveFunction'
    params = @($package, 'mint', 'mint')
} | ConvertTo-Json -Depth 10
$mint = Invoke-RestMethod -Uri $rpc -Method Post -ContentType 'application/json' -Body $functionBody
"has_mint_module=$($bcs.moduleMap.PSObject.Properties.Name -contains 'mint')"
$origins | ForEach-Object { "$($_.module_name)::$($_.datatype_name) origin=$($_.package)" }
$mint.result | ConvertTo-Json -Depth 20
~~~

Expected: mint module is True; Market, MarketCoin, and Version origins are 0xefe8...; normalized mint signature matches the approved design.

- [ ] **Step 2: Create the initial report**

Create docs/research/scallop-current-package-linkage.md with Scope and Mainnet Package Evidence sections. Include the exact RPC endpoint, current package, three concise origin lines, mint-module result, and complete normalized mint JSON observed in Step 1.

- [ ] **Step 3: Assert required origin evidence**

Run:

~~~powershell
$report = Get-Content -Raw .\docs\research\scallop-current-package-linkage.md
$required = @(
    'has_mint_module=True',
    'market::Market origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf',
    'reserve::MarketCoin origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf',
    'version::Version origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf'
)
$missing = $required | Where-Object { -not $report.Contains($_) }
if ($missing) { throw "Missing mainnet evidence: $($missing -join ', ')" }
~~~

Expected: exits 0.

- [ ] **Step 4: Commit**

~~~powershell
git add docs/research/scallop-current-package-linkage.md
git commit -m "docs: record Scallop mainnet linkage evidence"
~~~

---

### Task 2: Search Official Scallop History

**Files:**
- Modify: docs/research/scallop-current-package-linkage.md

- [ ] **Step 1: Clone complete history**

Run:

~~~powershell
$root = Join-Path $env:TEMP 'nexus-scallop-linkage'
$official = Join-Path $root 'sui-lending-protocol'
if (Test-Path $official) {
    $resolved = (Resolve-Path $official).Path
    $expectedRoot = (Resolve-Path $root).Path
    if (-not $resolved.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected path: $resolved"
    }
    Remove-Item -Recurse -Force -LiteralPath $resolved
}
New-Item -ItemType Directory -Force $root | Out-Null
git clone https://github.com/scallop-io/sui-lending-protocol.git $official
git -c safe.directory=$official -C $official fetch --all --tags --prune
~~~

Expected: clone and fetch succeed.

- [ ] **Step 2: Search all commits touching protocol manifests**

Run:

~~~powershell
$official = Join-Path $env:TEMP 'nexus-scallop-linkage\sui-lending-protocol'
$target = '0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a'
$commits = git -c safe.directory=$official -C $official log --all --format='%H' -- contracts/protocol/Move.toml contracts/protocol/Move.mainnet.toml
$matches = foreach ($commit in $commits) {
    $move = git -c safe.directory=$official -C $official show "$($commit):contracts/protocol/Move.toml" 2>$null
    $mainnet = git -c safe.directory=$official -C $official show "$($commit):contracts/protocol/Move.mainnet.toml" 2>$null
    if (($move -join [Environment]::NewLine).Contains($target) -or ($mainnet -join [Environment]::NewLine).Contains($target)) {
        $commit
    }
}
$matches = $matches | Select-Object -Unique
if ($matches) { 'OFFICIAL_MATCH'; $matches } else { 'NO_OFFICIAL_MATCH' }
~~~

Expected: OFFICIAL_MATCH plus SHAs, or NO_OFFICIAL_MATCH.

- [ ] **Step 3: Append official search evidence**

Append an Official Manifest Search section with repository URL, all-ref search scope, exact result, matching SHAs when present, and selected immutable official SHA. For NO_OFFICIAL_MATCH, record fallback base 334e93a1232a1d9417466080ae24491be3f7b27c and metadata-only fork required.

- [ ] **Step 4: Commit**

~~~powershell
git add docs/research/scallop-current-package-linkage.md
git commit -m "docs: record Scallop official manifest search"
~~~

---

### Task 3: Create And Verify Metadata-Only Fork When Required

**Files:**
- Modify: docs/research/scallop-current-package-linkage.md
- External fallback: https://github.com/stephentony100/sui-lending-protocol-nexus

- [ ] **Step 1: Determine selected path**

Run:

~~~powershell
$report = Get-Content -Raw .\docs\research\scallop-current-package-linkage.md
if ($report.Contains('OFFICIAL_MATCH')) {
    'OFFICIAL_MATCH_SELECTED'
} elseif ($report.Contains('NO_OFFICIAL_MATCH')) {
    'FALLBACK_FORK_REQUIRED'
} else {
    throw 'Official search result is missing.'
}
~~~

Expected: one exact status line.

For OFFICIAL_MATCH_SELECTED, append a Dependency Selection section containing official repository URL, contracts/protocol, selected immutable commit SHA, and fork used: no. Then continue to Step 7.

- [ ] **Step 2: Create local metadata commit for fallback**

Run only for FALLBACK_FORK_REQUIRED:

~~~powershell
$official = Join-Path $env:TEMP 'nexus-scallop-linkage\sui-lending-protocol'
$base = '334e93a1232a1d9417466080ae24491be3f7b27c'
$target = '0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a'
git -c safe.directory=$official -C $official checkout -B nexus-current-mainnet-package $base
$manifests = @(
    (Join-Path $official 'contracts\protocol\Move.toml'),
    (Join-Path $official 'contracts\protocol\Move.mainnet.toml')
)
foreach ($manifest in $manifests) {
    $content = Get-Content -Raw $manifest
    $replacement = 'published-at = "' + $target + '"'
    $updated = [regex]::Replace($content, '(?m)^published-at\s*=\s*"0x[0-9a-fA-F]+"$', $replacement)
    if ($updated -eq $content) { throw "published-at was not changed in $manifest" }
    Set-Content -LiteralPath $manifest -Value $updated -NoNewline
}
git -c safe.directory=$official -C $official diff -- contracts/protocol/Move.toml contracts/protocol/Move.mainnet.toml
git -c safe.directory=$official -C $official add contracts/protocol/Move.toml contracts/protocol/Move.mainnet.toml
git -c safe.directory=$official -C $official commit -m "chore: bind protocol manifest to current mainnet package"
$forkCommit = git -c safe.directory=$official -C $official rev-parse HEAD
"FORK_COMMIT=$forkCommit"
~~~

Expected: exactly two manifest files change, each only replacing published-at with 0xa45b..., and commit succeeds.

- [ ] **Step 3: Assert metadata-only difference**

Run:

~~~powershell
$official = Join-Path $env:TEMP 'nexus-scallop-linkage\sui-lending-protocol'
$base = '334e93a1232a1d9417466080ae24491be3f7b27c'
$head = git -c safe.directory=$official -C $official rev-parse HEAD
$changed = git -c safe.directory=$official -C $official diff --name-only $base $head
$expected = @('contracts/protocol/Move.mainnet.toml', 'contracts/protocol/Move.toml')
$unexpected = $changed | Where-Object { $_ -notin $expected }
$missing = $expected | Where-Object { $_ -notin $changed }
if ($unexpected -or $missing) {
    throw "Invalid changed files. Unexpected=$($unexpected -join ',') Missing=$($missing -join ',')"
}
$moveChanges = git -c safe.directory=$official -C $official diff --name-only $base $head -- '*.move'
if ($moveChanges) { throw "Move source changed: $($moveChanges -join ',')" }
$diff = git -c safe.directory=$official -C $official diff --unified=0 $base $head
$disallowed = $diff | Where-Object {
    $_ -match '^[+-]' -and $_ -notmatch '^\+\+\+|^---|^[+-]published-at\s*='
}
if ($disallowed) { throw "Non-metadata diff: $($disallowed -join [Environment]::NewLine)" }
'METADATA_ONLY_DIFF_VERIFIED'
~~~

Expected: METADATA_ONLY_DIFF_VERIFIED.

- [ ] **Step 4: Create fallback GitHub repository when absent**

Run only for FALLBACK_FORK_REQUIRED:

~~~powershell
$nl = [Environment]::NewLine
$credentialInput = 'protocol=https' + $nl + 'host=github.com' + $nl + $nl
$credentialLines = $credentialInput | git credential fill
$credential = @{}
foreach ($line in $credentialLines) {
    $parts = $line -split '=', 2
    if ($parts.Count -eq 2) { $credential[$parts[0]] = $parts[1] }
}
if (-not $credential.ContainsKey('password')) { throw 'GitHub credential is unavailable.' }
$headers = @{
    Authorization = 'Bearer ' + $credential['password']
    Accept = 'application/vnd.github+json'
    'X-GitHub-Api-Version' = '2022-11-28'
    'User-Agent' = 'nexus-linkage-spike'
}
try {
    Invoke-RestMethod -Uri 'https://api.github.com/repos/stephentony100/sui-lending-protocol-nexus' -Headers $headers | Out-Null
    'FORK_REPOSITORY_EXISTS'
} catch {
    if ($_.Exception.Response.StatusCode.value__ -ne 404) { throw }
    $payload = @{
        name = 'sui-lending-protocol-nexus'
        description = 'Pinned metadata-only Scallop dependency for Nexus package linkage'
        private = $false
        has_issues = $false
        has_projects = $false
        has_wiki = $false
    } | ConvertTo-Json
    Invoke-RestMethod -Uri 'https://api.github.com/user/repos' -Method Post -Headers $headers -ContentType 'application/json' -Body $payload | Out-Null
    'FORK_REPOSITORY_CREATED'
} finally {
    $credential.Clear()
}
~~~

Expected: repository exists or is created without printing credentials.

- [ ] **Step 5: Push metadata-only commit**

Run only for FALLBACK_FORK_REQUIRED:

~~~powershell
$official = Join-Path $env:TEMP 'nexus-scallop-linkage\sui-lending-protocol'
$remote = 'https://github.com/stephentony100/sui-lending-protocol-nexus.git'
if ((git -c safe.directory=$official -C $official remote) -contains 'nexus') {
    git -c safe.directory=$official -C $official remote set-url nexus $remote
} else {
    git -c safe.directory=$official -C $official remote add nexus $remote
}
git -c safe.directory=$official -C $official push -u nexus nexus-current-mainnet-package
$local = git -c safe.directory=$official -C $official rev-parse HEAD
$remoteLine = git ls-remote $remote 'refs/heads/nexus-current-mainnet-package'
$remoteSha = ($remoteLine -split '\s+')[0]
if ($local -ne $remoteSha) { throw "Remote SHA mismatch: local=$local remote=$remoteSha" }
"PINNED_FORK_COMMIT=$local"
~~~

Expected: remote SHA equals local immutable commit.

- [ ] **Step 6: Record fork proof**

For fallback, append a Dependency Selection section with official base SHA, selected fork URL, contracts/protocol, selected immutable fork SHA, branch name, exact two-file diff, .move source changes: none, dependency changes: none, type-origin changes: none, and METADATA_ONLY_DIFF_VERIFIED.

For official selection, record official repository, selected immutable official SHA, contracts/protocol, and fork used: no.

- [ ] **Step 7: Commit selection evidence**

~~~powershell
git add docs/research/scallop-current-package-linkage.md
git commit -m "docs: select verified Scallop linkage dependency"
~~~

---

### Task 4: Compile Exact Call And Storage Probe

**Files:**
- Modify: docs/research/scallop-current-package-linkage.md
- Temporary: %TEMP%\nexus-scallop-linkage\scallop_linkage_probe\Move.toml
- Temporary: %TEMP%\nexus-scallop-linkage\scallop_linkage_probe\sources\probe.move

- [ ] **Step 1: Resolve immutable selection**

Run:

~~~powershell
$report = Get-Content -Raw .\docs\research\scallop-current-package-linkage.md
if ($report.Contains('fork used: yes')) {
    $repo = 'https://github.com/stephentony100/sui-lending-protocol-nexus.git'
    $line = git ls-remote $repo 'refs/heads/nexus-current-mainnet-package'
    $commit = ($line -split '\s+')[0]
} else {
    $repo = 'https://github.com/scallop-io/sui-lending-protocol.git'
    $match = [regex]::Match($report, '(?m)^- selected commit: ([0-9a-f]{40})$')
    if (-not $match.Success) { throw 'Selected official commit is missing.' }
    $commit = $match.Groups[1].Value
}
if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'Selection is not an immutable SHA.' }
"SELECTED_REPO=$repo"
"SELECTED_COMMIT=$commit"
~~~

- [ ] **Step 2: Create probe package**

Run:

~~~powershell
$root = Join-Path $env:TEMP 'nexus-scallop-linkage'
$probe = Join-Path $root 'scallop_linkage_probe'
if (Test-Path $probe) {
    $resolved = (Resolve-Path $probe).Path
    $expectedRoot = (Resolve-Path $root).Path
    if (-not $resolved.StartsWith($expectedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected path: $resolved"
    }
    Remove-Item -Recurse -Force -LiteralPath $resolved
}
sui move new scallop_linkage_probe --path $root
~~~

- [ ] **Step 3: Write probe manifest**

Run:

~~~powershell
$report = Get-Content -Raw .\docs\research\scallop-current-package-linkage.md
if ($report.Contains('fork used: yes')) {
    $repo = 'https://github.com/stephentony100/sui-lending-protocol-nexus.git'
    $line = git ls-remote $repo 'refs/heads/nexus-current-mainnet-package'
    $commit = ($line -split '\s+')[0]
} else {
    $repo = 'https://github.com/scallop-io/sui-lending-protocol.git'
    $match = [regex]::Match($report, '(?m)^- selected commit: ([0-9a-f]{40})$')
    if (-not $match.Success) { throw 'Selected official commit is missing.' }
    $commit = $match.Groups[1].Value
}
if ($commit -notmatch '^[0-9a-f]{40}$') { throw 'Selection is not an immutable SHA.' }
$probe = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe'
$manifest = @"
[package]
name = "scallop_linkage_probe"
edition = "2024.beta"

[dependencies]
protocol = { git = "$repo", subdir = "contracts/protocol", rev = "$commit" }

[addresses]
scallop_linkage_probe = "0x0"
"@
Set-Content -LiteralPath (Join-Path $probe 'Move.toml') -Value $manifest -NoNewline
Get-Content -Raw (Join-Path $probe 'Move.toml')
~~~

Expected: manifest contains the selected URL and immutable 40-character SHA.

- [ ] **Step 4: Write exact probe source**

Create sources/probe.move:

~~~move
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
~~~

- [ ] **Step 5: Build under mainnet environment**

~~~powershell
$probe = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe'
sui move build --path $probe --build-env mainnet
~~~

Expected: exit 0 and BUILDING scallop_linkage_probe.

- [ ] **Step 6: Record and commit probe evidence**

Append a Concrete Move Probe section with selected URL, subdirectory, immutable SHA, exact probe source, full dependency/build lines, mint<SUI> result: compiled, Balance<MarketCoin<SUI>> result: compiled, and build result: succeeded.

~~~powershell
git add docs/research/scallop-current-package-linkage.md
git commit -m "docs: verify Scallop call and position storage probe"
~~~

---

### Task 5: Verify Resolved Publication Dependency ID

**Files:**
- Modify: docs/research/scallop-current-package-linkage.md

- [ ] **Step 1: Dump publication metadata**

Run:

~~~powershell
$probe = Join-Path $env:TEMP 'nexus-scallop-linkage\scallop_linkage_probe'
$outputPath = Join-Path $env:TEMP 'nexus-scallop-linkage\publish-metadata.txt'
sui move build --path $probe --build-env mainnet --dump-bytecode-as-base64 --no-tree-shaking --quiet |
    Tee-Object -FilePath $outputPath
~~~

Expected: command exits 0 and output contains serialized modules plus dependency package IDs. Set a 180-second command timeout. If it reaches the timeout without output, terminate it and classify the linkage result as REVISE rather than inferring success.

- [ ] **Step 2: Assert current package and reject older package**

Run:

~~~powershell
$outputPath = Join-Path $env:TEMP 'nexus-scallop-linkage\publish-metadata.txt'
$raw = Get-Content -Raw $outputPath
$target = '0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a'
$old = '0xde5c09ad171544aa3724dc67216668c80e754860f419136a68d78504eb2e2805'
if (-not $raw.Contains($target)) { throw "Current package absent: $target" }
if ($raw.Contains($old)) { throw "Older package still resolved: $old" }
'CURRENT_SCALLOP_DEPENDENCY_RESOLVED'
~~~

Expected: CURRENT_SCALLOP_DEPENDENCY_RESOLVED.

- [ ] **Step 3: Record and commit publication evidence**

Append a Publication Linkage section containing the exact command, current package, rejected older package, resolved dependency lines from the output, and CURRENT_SCALLOP_DEPENDENCY_RESOLVED.

~~~powershell
git add docs/research/scallop-current-package-linkage.md
git commit -m "docs: verify current Scallop publication linkage"
~~~

---

### Task 6: Make Final Decision

**Files:**
- Modify: docs/research/scallop-current-package-linkage.md

- [ ] **Step 1: Evaluate hard gates**

Run:

~~~powershell
$report = Get-Content -Raw .\docs\research\scallop-current-package-linkage.md
$gates = @(
    'has_mint_module=True',
    'market::Market origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf',
    'reserve::MarketCoin origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf',
    'version::Version origin=0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf',
    'mint<SUI> result: compiled',
    'Balance<MarketCoin<SUI>> result: compiled',
    'build result: succeeded',
    'CURRENT_SCALLOP_DEPENDENCY_RESOLVED'
)
$missing = $gates | Where-Object { -not $report.Contains($_) }
if ($missing) { 'DECISION_NOT_GO'; $missing } else { 'DECISION_GO' }
~~~

Expected for GO: DECISION_GO.

- [ ] **Step 2: Append one exact decision**

For DECISION_GO, append Status: GO and record selected repository, contracts/protocol, immutable SHA, current package, type origin, source-equivalence result, both compiled probe results, and verified publication linkage. State that the next phase is supply-only nexus_agent_wallet::scallop_adapter implementation.

When provenance and compile gates pass but publication metadata cannot be emitted or interpreted, append Status: REVISE, record the failed command/output, and state that production files remain unchanged.

When provenance, source equivalence, interface, type-origin, storage-type, or dependency-ID assertions fail, append Status: BLOCKED with the exact failed gate and state that production files remain unchanged.

- [ ] **Step 3: Verify report completeness**

Run:

~~~powershell
$reportPath = '.\docs\research\scallop-current-package-linkage.md'
$report = Get-Content -Raw $reportPath
$sections = @(
    '## Mainnet Package Evidence',
    '## Official Manifest Search',
    '## Dependency Selection',
    '## Concrete Move Probe',
    '## Publication Linkage',
    '## Decision'
)
$missing = $sections | Where-Object { -not $report.Contains($_) }
if ($missing) { throw "Missing sections: $($missing -join ', ')" }
$patterns = @('T' + 'BD', 'T' + 'ODO', 'sample label', 'write actual', 'record the', 'Paste the')
$redFlags = Select-String -Path $reportPath -Pattern $patterns -CaseSensitive:$false
if ($redFlags) { throw "Instructional text remains in report: $($redFlags.Line -join ' | ')" }
~~~

Expected: exits 0.

- [ ] **Step 4: Verify only the evidence report changed**

Run:

~~~powershell
$changed = git diff --name-only main...HEAD
$unexpected = $changed | Where-Object { $_ -ne 'docs/research/scallop-current-package-linkage.md' }
if ($unexpected) { throw "Unexpected Nexus files changed: $($unexpected -join ', ')" }
~~~

Expected: exits 0.

- [ ] **Step 5: Run Nexus regression tests**

Run:

~~~powershell
sui move test
~~~

Working directory: nexus_agent_wallet

Expected: 33 passed, 0 failed.

- [ ] **Step 6: Commit final decision**

Run:

~~~powershell
git add docs/research/scallop-current-package-linkage.md
git commit -m "docs: decide current Scallop package linkage"
git status --short --branch
git log --oneline -8
~~~

Expected: clean worktree except pre-existing untracked .claude if present.

---

## Completion Criteria

The phase is complete only when:

- official history and tags were searched before fallback creation;
- any fallback preserves official ancestry and changes only approved deployment metadata;
- selected dependency is pinned to an immutable SHA;
- mainnet type origins and normalized mint interface are recorded;
- mint<SUI> and Balance<MarketCoin<SUI>> compile;
- resolved publication dependency IDs are recorded or their verification failure is explicitly classified;
- report ends in GO, REVISE, or BLOCKED;
- no production Nexus files changed;
- Nexus Move tests pass.
