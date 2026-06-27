import { Transaction } from '@mysten/sui/transactions'
import type { PolicyAction, ScallopConfig } from './types.js'

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

export function buildScallopSupplySuiPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig,
  policyInitialSharedVersion?: string | number,
): Transaction {
  const tx = new Transaction()

  const policyArg =
    policyInitialSharedVersion === undefined
      ? tx.object(action.policyId)
      : tx.sharedObjectRef({
          objectId: action.policyId,
          initialSharedVersion: policyInitialSharedVersion,
          mutable: true,
        })

  const versionArg =
    scallop.versionInitialSharedVersion === undefined
      ? tx.object(scallop.versionObjectId)
      : tx.sharedObjectRef({
          objectId: scallop.versionObjectId,
          initialSharedVersion: scallop.versionInitialSharedVersion,
          mutable: false,
        })

  const marketArg =
    scallop.marketInitialSharedVersion === undefined
      ? tx.object(scallop.marketObjectId)
      : tx.sharedObjectRef({
          objectId: scallop.marketObjectId,
          initialSharedVersion: scallop.marketInitialSharedVersion,
          mutable: true,
        })

  tx.moveCall({
    target: `${packageId}::scallop_adapter::supply_sui`,
    arguments: [
      policyArg,
      tx.pure.u64(action.amount),
      tx.pure.vector('u8', Array.from(new TextEncoder().encode(walrusBlobId))),
      versionArg,
      marketArg,
      tx.sharedObjectRef({
        objectId: SUI_CLOCK_OBJECT_ID,
        initialSharedVersion: SUI_CLOCK_INITIAL_SHARED_VERSION,
        mutable: false,
      }),
    ],
  })

  return tx
}

export type BuildActionPtbResult =
  | { ok: true; tx: Transaction }
  | { ok: false; status: 'config_missing'; reason: string }
  | { ok: false; status: 'unsupported_action'; reason: string }

export function buildActionPtb(
  action: PolicyAction,
  walrusBlobId: string,
  packageId: string,
  scallop: ScallopConfig | undefined,
  policyInitialSharedVersion?: string | number,
): BuildActionPtbResult {
  if (action.protocol === 'scallop' && action.action === 'supply') {
    if (!scallop) {
      return { ok: false, status: 'config_missing', reason: 'scallop config required for scallop supply' }
    }
    return {
      ok: true,
      tx: buildScallopSupplySuiPtb(action, walrusBlobId, packageId, scallop, policyInitialSharedVersion),
    }
  }
  return { ok: true, tx: buildRecordActionPtb(action, walrusBlobId, packageId, policyInitialSharedVersion) }
}
