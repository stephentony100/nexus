# AgentRunner

Signs and submits the unsigned Sui PTBs that ActionFlow validates and builds,
calling `nexus_agent_wallet::policy::record_action` for real on a live network.

v1 scope: takes a plain-English action goal, runs it through ActionFlow's
`translateAction()`, then signs the result as the policy's approved agent,
dry-runs it, and submits it. This is the "can move real funds" boundary in
Nexus — ActionFlow itself never signs or submits anything. See
`docs/superpowers/specs/2026-06-18-agentrunner-design.md` for the full design.

**Note:** the agent's signing key is currently provisioned via a single
environment variable (`AGENTRUNNER_PRIVATE_KEY`) — a backend-controlled
stopgap until zkLogin/wallet integration exists. The agent's address must
hold enough SUI to pay gas for any submitted transaction.

## Setup

```bash
cd actionflow
npm install
npm run build
cd ../agentrunner
npm install
```

`actionflow` must be built first — `agentrunner` depends on its compiled
output (`actionflow/dist`) via a local `file:` dependency.

Requires `ANTHROPIC_API_KEY` in the environment (read automatically by the
Anthropic SDK, same as ActionFlow).

## Usage

```bash
export ACTIONFLOW_POLICY_ID=0x...        # the on-chain PolicyObject's ID
export ACTIONFLOW_PACKAGE_ID=0x...       # nexus_agent_wallet package address
export ACTIONFLOW_WALRUS_BLOB_ID=placeholder-blob-id   # opaque placeholder, no real Walrus integration yet
export AGENTRUNNER_PRIVATE_KEY=suiprivkey1...   # the policy's approved agent's key (sui keytool export format)
npm run cli -- "deposit 100 into scallop, yield looks better there"
```

Prints the recorded action's on-chain event and transaction digest on
success. On failure, prints details specific to where it failed:
validation errors (the goal couldn't be turned into a valid action), a
simulation rejection (an on-chain rule would have aborted — no gas spent),
an execution abort (rare: passed simulation but still aborted on
submission), a missing event (execution reported success but the expected
on-chain log entry wasn't found), or a submission failure (a network/RPC
problem talking to the chain). Exits 1 on anything but success.

## Tests

```bash
npm test
```
