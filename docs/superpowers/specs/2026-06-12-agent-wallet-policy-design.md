# Nexus AgentWallet PolicyObject Contract Design

## Source Of Truth

This design follows `Nexus.md`. Nexus is an AI-powered DeFi agent on Sui that turns plain-English user goals into executable on-chain actions, while enforcing strict user-approved limits through on-chain policy objects.

The first smart contract focuses on the safety primitive: the AI can act only inside rules the user created and can revoke.

## Scope

Build the first Sui Move package: `nexus_agent_wallet`.

The MVP creates and manages a `PolicyObject` that records what an approved agent is allowed to do. It does not custody user funds, integrate Scallop or DeepBook directly, or enforce portfolio drawdown from oracle data. Those features belong in later packages once protocol interfaces and valuation inputs are defined.

## Goals

- Let a user create a policy for one approved agent address.
- Enforce simple on-chain limits: allowed protocols, maximum single action amount, total budget, expiry, paused state, and revoked state.
- Let only the owner pause, resume, or revoke the policy.
- Let only the approved agent record an action.
- Emit events that connect on-chain activity to Walrus reasoning blobs.
- Provide tests for all permission and limit checks.

## Non-Goals

- Holding user funds in the policy object.
- Executing real Scallop, DeepBook, or other DeFi protocol calls.
- Computing drawdown, portfolio value, or weekly loss limits.
- Building zkLogin or backend IntentFlow logic.
- Storing full AI reasoning on-chain.

## Contract Package

Package name: `nexus_agent_wallet`

Primary module: `policy`

Primary object: `PolicyObject`

## Data Model

`PolicyObject` stores:

- `id: UID`
- `owner: address`
- `agent: address`
- `max_total_budget: u64`
- `spent_total: u64`
- `max_single_tx: u64`
- `allowed_protocols: vector<vector<u8>>`
- `expires_at_ms: u64`
- `paused: bool`
- `revoked: bool`
- `created_at_ms: u64`

Protocol IDs are byte vectors so the first version can use stable labels such as `b"scallop"` and `b"deepbook"` without binding to external package addresses. Later adapters can replace or supplement these labels with stricter package/module/function allowlists.

## Public API

### `create_policy`

Creates a new `PolicyObject` owned by the transaction sender.

Inputs:

- approved agent address
- maximum total budget
- maximum single action amount
- allowed protocol IDs
- expiry timestamp in milliseconds
- `Clock`

Validation:

- total budget must be greater than zero
- single transaction limit must be greater than zero
- single transaction limit must not exceed total budget
- allowed protocol list must not be empty
- expiry must be greater than current time

Effects:

- creates a shared policy object so the approved agent can call `record_action`
- emits `PolicyCreated`

The policy remains controlled by the stored `owner` field. Sharing the object makes it callable by the agent, but owner-only functions still check `tx_context::sender`.

### `pause_policy`

Pauses an active policy.

Validation:

- caller must be `owner`
- policy must not be revoked

Effects:

- sets `paused` to `true`
- emits `PolicyPaused`

### `resume_policy`

Resumes a paused policy.

Validation:

- caller must be `owner`
- policy must not be revoked
- policy must not be expired

Effects:

- sets `paused` to `false`
- emits `PolicyResumed`

### `revoke_policy`

Permanently disables a policy.

Validation:

- caller must be `owner`

Effects:

- sets `revoked` to `true`
- emits `PolicyRevoked`

### `record_action`

Records an agent action that has passed policy checks.

Inputs:

- protocol ID
- amount
- Walrus blob ID or reasoning reference
- `Clock`

Validation:

- caller must be the approved `agent`
- policy must not be paused
- policy must not be revoked
- current time must be before or equal to `expires_at_ms`
- protocol ID must be in `allowed_protocols`
- amount must be greater than zero
- amount must not exceed `max_single_tx`
- `spent_total + amount` must not exceed `max_total_budget`

Effects:

- increments `spent_total`
- emits `ActionRecorded`

## Events

### `PolicyCreated`

Fields:

- policy ID
- owner
- agent
- max total budget
- max single transaction amount
- expiry timestamp
- created timestamp

### `PolicyPaused`

Fields:

- policy ID
- owner
- timestamp

### `PolicyResumed`

Fields:

- policy ID
- owner
- timestamp

### `PolicyRevoked`

Fields:

- policy ID
- owner
- timestamp

### `ActionRecorded`

Fields:

- policy ID
- agent
- protocol ID
- amount
- spent total after action
- Walrus blob ID or reasoning reference
- timestamp

## Error Handling

The module will define explicit abort codes for:

- invalid budget
- invalid single transaction limit
- empty protocol list
- invalid expiry
- caller is not owner
- caller is not approved agent
- policy is paused
- policy is revoked
- policy is expired
- protocol is not allowed
- amount is zero
- amount exceeds single transaction limit
- amount exceeds total budget

## Testing

Move tests must cover:

- owner can create a valid policy
- invalid budgets are rejected
- invalid expiry is rejected
- empty protocol list is rejected
- owner can pause, resume, and revoke
- non-owner cannot pause, resume, or revoke
- approved agent can record a valid action
- wrong agent cannot record an action
- disallowed protocol is rejected
- zero amount is rejected
- amount over the single transaction limit is rejected
- cumulative amount over the total budget is rejected
- expired policy rejects actions
- paused policy rejects actions
- revoked policy rejects actions
- valid action updates `spent_total`

## Later Extensions

Later packages can build on this contract with:

- custody vaults that hold user funds
- protocol-specific adapters for Scallop and DeepBook
- package/module/function allowlists instead of protocol labels
- drawdown and weekly loss enforcement with oracle-backed portfolio valuation
- policy editing with versioned constraints
- richer Walrus metadata schemas
