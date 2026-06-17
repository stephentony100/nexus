Nexus is an **AI-powered DeFi agent on Sui** that lets users describe a financial goal in plain English, turns that goal into executable Sui transactions, and only acts within strict on-chain limits the user approves.

The simple idea:

**“Tell Nexus what you want your money to do. Nexus plans the strategy, checks the risk, and executes only within the spending rules you set.”**

## **How it works**

A user logs in with **zkLogin**, so they can start with something familiar like Google instead of managing seed phrases immediately.

They type a goal like:

“Put $500 into a conservative yield strategy. Do not risk more than 5% drawdown. Only use Scallop and DeepBook. Rebalance monthly.”

Nexus then converts that instruction into a structured strategy:

* how much capital can be used  
* which protocols are allowed  
* what risk level is acceptable  
* how often actions can happen  
* when the permission expires

Before the AI can touch any funds, the user creates an **AgentWallet PolicyObject** on-chain.

This PolicyObject is the most important part.

It acts like a smart contract permission box around the AI.

For example, the policy can say:

* Maximum budget: $500  
* Allowed protocols: Scallop and DeepBook only  
* Maximum single transaction: $100  
* Maximum weekly loss: 5%  
* Expiry: 30 days  
* User can revoke anytime

So even if the AI makes a bad decision, hallucinates, or the backend is compromised, it cannot exceed the policy because the Move contract blocks invalid transactions.

That means Nexus is not just “trust the AI.”

It is:

**AI with on-chain boundaries.**

## **What Nexus actually does**

Once the policy is active, Nexus can monitor opportunities across Sui DeFi.

For example:

* If Scallop lending yield is better and safer, it can deposit there.  
* If a DeepBook trade improves the portfolio allocation, it can execute it.  
* If the portfolio drifts away from the user’s target, it can rebalance.  
* If risk becomes too high, it can move funds back to a safer position.

The AI does not just randomly act. It follows the user’s original intent and the on-chain policy.

## **Where IntentFlow fits in**

IntentFlow is the part that turns plain English into real actions.

The user says:

“Grow my portfolio conservatively.”

IntentFlow translates that into something the system can execute:

* deposit USDC into Scallop  
* keep some USDC liquid  
* swap a small portion through DeepBook  
* rebalance only when allocation drifts above a certain threshold

Then it builds a **Programmable Transaction Block**, or PTB.

This is powerful on Sui because multiple actions can happen atomically.

For example:

Withdraw from one position → swap on DeepBook → deposit into Scallop

can happen as one transaction.

Either everything succeeds, or everything fails. There is no halfway state.

## **Where AgentWallet fits in**

AgentWallet is the safety layer.

It gives the AI limited authority instead of full wallet access.

The user does not hand over their wallet. They create a restricted agent permission.

The agent can only do what the PolicyObject allows.

This makes Nexus much safer than a normal AI trading bot because the restrictions are enforced on-chain, not just in backend code.

## **Where Walrus fits in**

Every action Nexus takes is logged.

The AI’s reasoning is stored as a **Walrus blob**, and the on-chain transaction log links to that blob.

So the user can inspect:

* what Nexus did  
* when it acted  
* which protocols it used  
* why it made that decision  
* what the result was

This gives the product transparency.

The agent also uses Walrus as memory, meaning it can remember previous actions, strategy history, and portfolio performance across sessions.

## **The full product in one flow**

1. User logs in with zkLogin.  
2. User enters a goal in plain English.  
3. Nexus converts the goal into a strategy.  
4. User reviews the proposed rules.  
5. A PolicyObject is created on-chain.  
6. Nexus monitors Sui DeFi opportunities.  
7. Nexus builds PTBs when action is needed.  
8. The PolicyObject checks if the action is allowed.  
9. If valid, the transaction executes.  
10. The action and AI reasoning are logged using Walrus.  
11. User can pause, edit, or revoke the agent anytime.

## **The one-line pitch**

**Nexus is a cryptographically constrained DeFi agent on Sui that turns plain-English financial goals into safe, on-chain actions using policy-limited agent wallets, PTBs, zkLogin, and Walrus-backed transparency.**

This is strong because it is not just an AI portfolio manager.

It is a safer model for autonomous finance:

**The AI can act, but it cannot break the rules.**

