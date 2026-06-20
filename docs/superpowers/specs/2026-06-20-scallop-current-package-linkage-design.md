# Scallop Current-Package Linkage Design

## Goal

Produce a reproducible, pinned Scallop Move dependency that preserves official Scallop source and type identities while linking Nexus to current mainnet protocol package **0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a**.

This phase verifies dependency provenance and package linkage only. It does not modify PolicyObject, add the production adapter, or change TypeScript transaction generation.

## Known Interface

The verified Scallop supply interface is:

~~~move
public fun mint<T>(
    version: &Version,
    market: &mut Market,
    coin: Coin<T>,
    clock: &Clock,
    ctx: &mut TxContext,
): Coin<MarketCoin<T>>
~~~

Current mainnet integration values:

- call package: **0xa45b8ffca59e5b44ec7c04481a04cb620b0e07b2b183527bca4e5f32372c5f1a**
- expected named type origin: **0xefe8b36d5b2e43728cc323298626b83177803521d195cfb11e15b910e892fddf**
- version object: **0x07871c4b3c847a0f674510d4978d5cf6f960452795e8ff6f189fd2088a3f6ac7**
- market object: **0xa757975255146dc9686aa823b7838b507f315d704f428cbadad2f4ea061939d9**

The type origin is a verification target, not an assumption. Mainnet RPC evidence must confirm it for every Scallop type Nexus depends on.

## Dependency Strategy

Use these approaches in priority order:

1. Use an official Scallop source commit or tag whose protocol manifest targets current package **0xa45b...**.
2. If no official current manifest exists, use a pinned metadata-only fork based on verified official source.
3. Reject handwritten or local interface packages.

The fallback fork is acceptable only when it preserves official source and commit history and changes deployment metadata required for current-package linkage.

## Metadata-Only Fork Rules

The fork must:

- derive from a specific official Scallop commit;
- retain the official commit in its ancestry;
- change only approved deployment metadata such as published-at;
- leave all .move source files unchanged;
- leave dependency declarations and revisions unchanged;
- leave named addresses unchanged unless the only required change is the approved published-at or address metadata needed to bind to **0xa45b...**;
- contain no logic, module, type, function, or test behavior changes;
- be referenced by an immutable commit SHA, never a branch name.

Any difference outside the explicitly approved deployment-metadata change invalidates the fork.

## Verification Flow

### Mainnet Type And Interface Verification

Query package **0xa45b...** through Sui mainnet RPC and verify:

- protocol::reserve::MarketCoin originates at **0xefe8...**;
- protocol::market::Market originates at **0xefe8...**;
- protocol::version::Version originates at **0xefe8...**;
- the current package contains module mint;
- normalized mint::mint accepts &Version, &mut Market, Coin<T>, &Clock, and &mut TxContext;
- normalized mint::mint returns Coin<MarketCoin<T>>.

### Official Manifest Search

Search the official Scallop repository history and tags for a protocol manifest whose published-at equals current package **0xa45b...**.

Use an official matching commit when one exists. Do not create a fork merely for convenience.

### Fallback Fork Verification

When no official matching manifest exists:

1. Create a fork branch from the verified official commit.
2. Change only protocol deployment metadata needed to target **0xa45b...**.
3. Commit the metadata change.
4. Compare the resulting commit against the official base commit.
5. Verify zero .move, dependency, named-address, or logic changes.
6. Pin the probe dependency to the fork commit SHA and contracts/protocol subdirectory.

### Compile Probe

The temporary probe must compile under an explicit mainnet build environment and prove both the adapter call and planned policy storage type:

~~~move
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

The probe does not need to construct PositionProbe; successful compilation of the field type proves Nexus can declare Balance<MarketCoin<SUI>> in policy-owned state.

### Publish Linkage Verification

Inspect generated publication metadata or an equivalent Sui package-management artifact and verify the Scallop dependency resolves to current package **0xa45b...**, not older manifest value **0xde5c...**.

A normal source compile is insufficient for GO. The resolved dependency package ID must be recorded explicitly.

## Evidence

Commit a linkage report containing:

- official repository URL and base commit SHA;
- official history and tag search results;
- selected dependency repository, subdirectory, and immutable commit SHA;
- exact manifest diff;
- proof that .move sources and dependency declarations are unchanged;
- mainnet RPC type-origin evidence;
- normalized mint::mint signature evidence;
- concrete mint<SUI> and Balance<MarketCoin<SUI>> probe source;
- build command and output;
- resolved publication dependency IDs;
- final GO, REVISE, or BLOCKED decision.

## Failure Handling

### GO

Use GO only when provenance, source equivalence, type origins, normalized interface, concrete SUI call, position storage type, build, and current-package dependency linkage all pass.

### REVISE

Use REVISE when verified Sui package-management behavior requires a different safe dependency configuration and a concrete next approach remains.

### BLOCKED

Use BLOCKED when official source cannot be safely bound to current package **0xa45b...** without source changes, an unsafe interface package, or unverifiable dependency metadata.

No production adapter or policy changes are allowed for REVISE or BLOCKED.

## Security Constraints

- Never accept a floating dependency branch.
- Never accept a fork with Move source or dependency changes.
- Never infer type compatibility from names alone; verify mainnet type origins.
- Never treat a successful source compile as proof of current-package linkage.
- Never introduce a handwritten Scallop interface package.
- Preserve all commands and outputs needed to reproduce the decision.

## Deliverables

This phase produces:

- a verified official dependency or metadata-only fork commit;
- a temporary concrete linkage probe;
- a committed linkage evidence report;
- a final GO, REVISE, or BLOCKED decision.

Production scallop_adapter::supply_sui implementation begins only after GO.
