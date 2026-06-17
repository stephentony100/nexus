# IntentFlow

Translates a plain-English policy-setup goal into a validated strategy and
an unsigned Sui PTB calling `nexus_agent_wallet::policy::create_policy`.

v1 scope: policy-setup goals only (budget, max single tx, allowed
protocols, expiry). Construct-only — no signing, no submission. See
`docs/superpowers/specs/2026-06-17-intentflow-design.md` for the full design.

## Setup

```bash
cd intentflow
npm install
```

Requires `ANTHROPIC_API_KEY` in the environment (read automatically by the
Anthropic SDK).

## Usage

```bash
export INTENTFLOW_PACKAGE_ID=0x...   # nexus_agent_wallet package address
npm run cli -- "Let agent 0xabc...123 trade on Scallop and DeepBook with a \$500 budget, max \$100 per trade, expiring in 30 days"
```

Prints the extracted strategy as JSON and the built PTB as base64 on
success, or a list of field-level errors (exit code 1) if the goal is
missing required information or violates a policy rule.

## Tests

```bash
npm test
```
