import { Transaction } from '@mysten/sui/transactions'
import type { PolicyStrategy } from './types.js'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SUI_CLOCK_INITIAL_SHARED_VERSION = 1

export function buildCreatePolicyPtb(strategy: PolicyStrategy, packageId: string): Transaction {
  const tx = new Transaction()

  const allowedProtocolsBytes = strategy.allowedProtocols.map((protocol) =>
    Array.from(new TextEncoder().encode(protocol)),
  )

  tx.moveCall({
    target: `${packageId}::policy::create_policy`,
    arguments: [
      tx.pure.address(strategy.agentAddress),
      tx.pure.u64(strategy.maxTotalBudget),
      tx.pure.u64(strategy.maxSingleTx),
      tx.pure.vector('vector<u8>', allowedProtocolsBytes),
      tx.pure.u64(strategy.expiresAtMs),
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}
