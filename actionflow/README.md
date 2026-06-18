# ActionFlow

Translates a plain-English DeFi action goal into a validated action and an
unsigned Sui PTB calling `nexus_agent_wallet::policy::record_action`.

v1 scope: parses the action via Claude, fetches the live `PolicyObject`
from chain, validates the action against that live state (replicating
`record_action`'s on-chain checks), and builds the PTB. Construct-only —
no signing, no submission, no real protocol calls. See
`docs/superpowers/specs/2026-06-18-actionflow-design.md` for the full design.

**Note:** validation cannot check that the eventual transaction sender is
the policy's approved `agent` — there is no signer in this library. That
check still happens on-chain (`ENotAgent`) when the PTB is later submitted.

## Setup

```bash
cd actionflow
npm install
```

Requires `ANTHROPIC_API_KEY` in the environment (read automatically by the
Anthropic SDK).

## Usage

```bash
export ACTIONFLOW_POLICY_ID=0x...        # the on-chain PolicyObject's ID
export ACTIONFLOW_PACKAGE_ID=0x...       # nexus_agent_wallet package address
export ACTIONFLOW_WALRUS_BLOB_ID=placeholder-blob-id   # opaque placeholder, no real Walrus integration yet
npm run cli -- "deposit 100 into scallop, yield looks better there"
```

Prints the extracted action as JSON and the built PTB as base64 on
success, or a list of field-level errors (exit code 1) if the goal is
missing required information or violates a policy rule.

## Tests

```bash
npm test
```
