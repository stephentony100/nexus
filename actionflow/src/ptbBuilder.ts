import { Transaction } from '@mysten/sui/transactions'
import type { PolicyAction } from './types.js'

const SUI_CLOCK_OBJECT_ID = '0x6'
const SUI_CLOCK_INITIAL_SHARED_VERSION = 1

export function buildRecordActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  policyInitialSharedVersion?: string | number,
): Transaction {
  const tx = new Transaction()

  // PolicyObject is a shared object on-chain (transfer::share_object in policy.move).
  // Sui requires the object's current shared version to build a transaction offline
  // (without a client to resolve it) — same reason the Clock reference below needs one.
  const policyArg =
    policyInitialSharedVersion === undefined
      ? tx.object(action.policyId)
      : tx.sharedObjectRef({
          objectId: action.policyId,
          initialSharedVersion: policyInitialSharedVersion,
          mutable: true,
        })

  tx.moveCall({
    target: `${packageId}::policy::record_action`,
    arguments: [
      policyArg,
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(action.protocol))),
      tx.pure.u64(action.amount),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(walrusBlobId))),
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}
