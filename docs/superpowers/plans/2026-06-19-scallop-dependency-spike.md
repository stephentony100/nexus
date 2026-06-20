# Scallop Dependency Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the exact Scallop Move dependency/interface needed to implement Nexus' on-chain Scallop SUI supply adapter safely.

**Architecture:** This is a research-and-proof spike, not the production adapter. It produces a committed dependency report that either gives the exact Move dependency/import path for Scallop `mint`, `Market`, `Version`, and `MarketCoin`, or documents a concrete blocker before production code is attempted.

**Tech Stack:** Sui Move 2024, Sui CLI, GitHub-hosted Scallop docs/repos, Scallop TypeScript SDK inspection, PowerShell.

---

## File Structure

- Create: `docs/research/scallop-sui-supply-interface.md`
  - Records the verified Scallop supply interface, package IDs, dependency attempts, compile results, and final recommendation.
- Optional temp-only files under `C:\Users\NT\AppData\Local\Temp\nexus-scallop-probe`
  - Used for dependency compile probes. Do not commit temp probe files.

No production files are modified in this spike:

- Do not modify `nexus_agent_wallet/sources/policy.move`.
- Do not modify `nexus_agent_wallet/Move.toml`.
- Do not modify ActionFlow, AgentRunner, IntentFlow, or PolicyLoop.

## Success Criteria

The spike is complete when `docs/research/scallop-sui-supply-interface.md` states one of these outcomes:

- **GO:** exact Scallop Move dependency/import path is verified by a local `sui move build` probe.
- **BLOCKED:** official Scallop Move dependency cannot be consumed directly, with command output showing why.
- **REVISE:** Scallop dependency is unavailable in a Move-consumable form, and the adapter design must be revised before production implementation.

---

### Task 1: Record Scallop Interface Evidence

**Files:**
- Create: `docs/research/scallop-sui-supply-interface.md`

- [ ] **Step 1: Create the research directory**

Run:

```powershell
New-Item -ItemType Directory -Force .\docs\research | Out-Null
```

Expected: `docs/research` exists.

- [ ] **Step 2: Create the initial report**

Create `docs/research/scallop-sui-supply-interface.md` with:

```markdown
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

```

- [ ] **Step 3: Commit the initial report**

Run:

```powershell
git add docs/research/scallop-sui-supply-interface.md
git commit -m "docs: start Scallop SUI supply interface research"
```

Expected: commit succeeds.

---

### Task 2: Check Official Scallop Repositories

**Files:**
- Modify: `docs/research/scallop-sui-supply-interface.md`

- [ ] **Step 1: Check candidate Scallop repository availability**

Run:

```powershell
git ls-remote https://github.com/scallop-io/sui-lending-protocol.git
```

Expected if public: prints refs. Expected if unavailable: exits non-zero with repository/network error.

Run:

```powershell
git ls-remote https://github.com/scallop-io/sui-scallop-sdk.git
```

Expected: prints refs for the TypeScript SDK repo.

- [ ] **Step 2: Inspect whether the SDK repo contains Move packages**

Run:

```powershell
$probe = Join-Path $env:TEMP "nexus-scallop-probe"
Remove-Item -Recurse -Force $probe -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $probe | Out-Null
git clone --depth 1 https://github.com/scallop-io/sui-scallop-sdk.git (Join-Path $probe "sui-scallop-sdk")
Get-ChildItem -Path (Join-Path $probe "sui-scallop-sdk") -Recurse -Filter Move.toml | Select-Object -ExpandProperty FullName
```

Expected: either one or more `Move.toml` files, or no output.

- [ ] **Step 3: Update the report**

Append this `## Git Repository Checks` section to `docs/research/scallop-sui-supply-interface.md` with actual observed command results. Do not leave sample values in the report.

```markdown
## Git Repository Checks

### `scallop-io/sui-lending-protocol`

- Command: `git ls-remote https://github.com/scallop-io/sui-lending-protocol.git`
- Result: write one sentence with the actual result.
- Evidence: paste the first useful ref line or the exact error summary.

### `scallop-io/sui-scallop-sdk`

- Command: `git ls-remote https://github.com/scallop-io/sui-scallop-sdk.git`
- Result: write one sentence with the actual result.
- Evidence: paste the first useful ref line or the exact error summary.

### Move Package Search In SDK Repo

- Command: `Get-ChildItem ... -Filter Move.toml`
- Result: write the exact `Move.toml` paths found, or write `No Move.toml files found in the SDK repo clone.`
```

- [ ] **Step 4: Commit repository check results**

Run:

```powershell
git add docs/research/scallop-sui-supply-interface.md
git commit -m "docs: record Scallop repository availability"
```

Expected: commit succeeds.

---

### Task 3: Inspect Scallop SDK Supply Builder

**Files:**
- Modify: `docs/research/scallop-sui-supply-interface.md`

- [ ] **Step 1: Search the cloned SDK for supply builder calls**

Run:

```powershell
$sdk = Join-Path $env:TEMP "nexus-scallop-probe\sui-scallop-sdk"
Get-ChildItem -Path $sdk -Recurse -Include *.ts,*.md | Select-String -Pattern "depositQuick|deposit\\(|mint::mint|MarketCoin|SCALLOP_MARKET|SCALLOP_VERSION" | Select-Object Path,LineNumber,Line | Format-List
```

Expected: output showing SDK docs/source references for deposit/mint.

- [ ] **Step 2: Inspect package metadata**

Run:

```powershell
Get-Content -Raw (Join-Path $sdk "package.json")
```

Expected: package metadata including the current SDK version.

- [ ] **Step 3: Update the report**

Append this `## NPM SDK Inspection` section to `docs/research/scallop-sui-supply-interface.md` with actual source references. Do not leave sample rows in the committed report.

```markdown
## NPM SDK Inspection

The TypeScript SDK exposes Scallop lending supply through builder methods such as `depositQuick` and `deposit`.

Observed source references:

- Add one bullet per useful source reference in the form `path:line — summary`.

Package metadata:

- package name: write the exact package name from `package.json`.
- version: write the exact version from `package.json`.

SDK implication for Nexus:

- ActionFlow can later use object IDs and PTB argument order validated here.
- The SDK alone does not solve Move-side `MarketCoin<SUI>` type coupling inside `PolicyObject`.
```

- [ ] **Step 4: Commit SDK inspection results**

Run:

```powershell
git add docs/research/scallop-sui-supply-interface.md
git commit -m "docs: inspect Scallop SDK supply builder"
```

Expected: commit succeeds.

---

### Task 4: Probe Move Dependency Feasibility

**Files:**
- Modify: `docs/research/scallop-sui-supply-interface.md`

- [ ] **Step 1: Create a temporary Move probe package**

Run:

```powershell
$probe = Join-Path $env:TEMP "nexus-scallop-probe"
$pkg = Join-Path $probe "scallop_move_probe"
Remove-Item -Recurse -Force $pkg -ErrorAction SilentlyContinue
sui move new scallop_move_probe --path $probe
```

Expected: temp package created at `%TEMP%\nexus-scallop-probe\scallop_move_probe`.

- [ ] **Step 2: Try a direct dependency only if a Move package was found**

If Task 2 found a Scallop repo `Move.toml`, edit `%TEMP%\nexus-scallop-probe\scallop_move_probe\Move.toml` to depend on that repo/path and create a source file importing:

```move
module scallop_move_probe::probe {
    use sui::clock::Clock;
    use sui::coin::Coin;
    use sui::sui::SUI;
    use sui::tx_context::TxContext;

    use scallop_protocol::mint;
    use scallop_protocol::Market;
    use scallop_protocol::Version;
    use scallop_protocol::reserve::MarketCoin;

    public fun compile_probe(
        version: &Version,
        market: &mut Market,
        coin: Coin<SUI>,
        clock: &Clock,
        ctx: &mut TxContext,
    ): Coin<MarketCoin<SUI>> {
        mint::mint<SUI>(version, market, coin, clock, ctx)
    }
}
```

Then run:

```powershell
sui move build --path $pkg
```

Expected if dependency works: build succeeds. Expected if imports differ: compiler errors identify actual module/type names.

- [ ] **Step 3: Record blocker if no Move package was found**

If Task 2 found no Scallop Move package, do not invent one. Record:

```markdown
No public Scallop Move package path was found in the inspected repositories, so the direct dependency probe could not be run.
```

- [ ] **Step 4: Update the report**

Append this `## Move Dependency Probe` section to `docs/research/scallop-sui-supply-interface.md` with actual probe results. Do not leave sample values in the committed report.

```markdown
## Move Dependency Probe

Probe package path: `%TEMP%\nexus-scallop-probe\scallop_move_probe`

Dependency attempted:

- Write the exact git URL, subdir, and rev attempted, or write `No direct dependency attempted because no public Move package path was found.`

Compile result:

- Write `succeeded`, `failed`, or `skipped`.

Compiler output summary:

```text
Paste the relevant success line or the first compiler error block.
```

Verified import names:

- `mint`: write `verified` or `unresolved`.
- `Market`: write `verified` or `unresolved`.
- `Version`: write `verified` or `unresolved`.
- `MarketCoin`: write `verified` or `unresolved`.
```

- [ ] **Step 5: Commit Move dependency probe results**

Run:

```powershell
git add docs/research/scallop-sui-supply-interface.md
git commit -m "docs: record Scallop Move dependency probe"
```

Expected: commit succeeds.

---

### Task 5: Make The Adapter Go/No-Go Decision

**Files:**
- Modify: `docs/research/scallop-sui-supply-interface.md`

- [ ] **Step 1: Add the final decision section**

Append one of these exact decision blocks.

Use this if the Move dependency compiled:

```markdown
## Decision

Status: GO

Nexus can implement `nexus_agent_wallet::scallop_adapter` directly against Scallop's Move package.

Production implementation plan should use:

- Move dependency: write the exact git URL, subdir, and rev verified by the probe.
- Imports:
  - `mint`: write the verified module path.
  - `Market`: write the verified type path.
  - `Version`: write the verified type path.
  - `MarketCoin`: write the verified type path.

Next plan:

- Add Scallop dependency to `nexus_agent_wallet/Move.toml`.
- Extend `PolicyObject` with `Balance<MarketCoin<SUI>>`.
- Add `scallop_adapter::supply_sui`.
- Use a real Scallop compile dependency in production code.
```

Use this if no consumable Move dependency exists:

```markdown
## Decision

Status: BLOCKED

The desired on-chain adapter design depends on Scallop's `MarketCoin<SUI>` type, but no consumable public Move package/interface was verified by this spike.

Do not implement production `PolicyObject.scallop_sui_position: Balance<MarketCoin<SUI>>` until the dependency is resolved.

Next plan:

- Either obtain the official Scallop Move package source/interface from Scallop documentation or maintainers,
- or revise the architecture to a different integration boundary with explicitly accepted tradeoffs.
```

Use this if a dependency exists but import names differ:

```markdown
## Decision

Status: REVISE

A Scallop Move dependency appears available, but the documented import shape differs from the compile probe.

Before production implementation, update `docs/superpowers/specs/2026-06-19-scallop-sui-supply-adapter-design.md` with the verified module/type paths from this report.
```

- [ ] **Step 2: Commit the decision**

Run:

```powershell
git add docs/research/scallop-sui-supply-interface.md
git commit -m "docs: decide Scallop adapter dependency path"
```

Expected: commit succeeds.

- [ ] **Step 3: Final verification**

Run:

```powershell
git status --short
git log --oneline -5
```

Expected: clean worktree except pre-existing untracked `.claude/`, and the latest commits are the Scallop research commits.

---

## Completion Criteria

This spike does not produce the adapter.

It is complete only when:

- `docs/research/scallop-sui-supply-interface.md` exists.
- The report includes Git repository checks.
- The report includes SDK inspection.
- The report includes Move dependency probe results or a documented reason the probe could not run.
- The report ends with `Status: GO`, `Status: BLOCKED`, or `Status: REVISE`.
- All report changes are committed.
