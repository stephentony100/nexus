# PolicyLoop

Decides whether to act on a policy and, if so, drives ActionFlow's
validate/build and AgentRunner's sign/submit to do it — runs exactly one
decision cycle per invocation and exits.

v1 scope: a fixed, deterministic decision template — no real DeFi market
data, no AI reasoning. Each cycle re-fetches the policy's live on-chain
state and either skips (paused, revoked, expired, budget exhausted, no
allowed protocols) or proposes a deposit into the policy's first allowed
protocol, for the largest amount the remaining budget and per-transaction
limit allow. There is no daemon or internal scheduling — an external
scheduler (cron, hosted cron, etc.) is responsible for invoking this
repeatedly. See `docs/superpowers/specs/2026-06-18-policyloop-design.md`
for the full design.

## Setup

```bash
cd actionflow
npm install
npm run build
cd ../agentrunner
npm install
npm run build
cd ../policyloop
npm install
```

`actionflow` and `agentrunner` must both be built first — `policyloop`
depends on their compiled output (`actionflow/dist`, `agentrunner/dist`)
via local `file:` dependencies.

## Usage

```bash
export ACTIONFLOW_POLICY_ID=0x...        # the on-chain PolicyObject's ID
export ACTIONFLOW_PACKAGE_ID=0x...       # nexus_agent_wallet package address
export ACTIONFLOW_WALRUS_BLOB_ID=placeholder-blob-id   # opaque placeholder, no real Walrus integration yet
export AGENTRUNNER_PRIVATE_KEY=suiprivkey1...   # the policy's approved agent's key (sui keytool export format)
npm run cli
```

Prints `Skipped: <reason>` if the policy isn't actionable this cycle.
Otherwise prints the same outcomes as AgentRunner's CLI: the recorded
action's on-chain event and digest on success, or details specific to
where it failed (validation, simulation, execution abort, missing event,
submission failure). Exits 0 for `succeeded`/`skipped`, exits 1 on
anything else.

## Tests

```bash
npm test
```
