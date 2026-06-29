#!/usr/bin/env node
import { readScallopConfig, readAiConfig, readDaemonConfig, readWalrusConfig } from '../src/config.js'
import { WalrusUploaderImpl } from '../src/walrus.js'
import { runDaemon, runMultiPolicyDaemon } from '../src/daemon.js'
import type { LogRecord } from '../src/daemon.js'
import type { PolicyLoopOptions } from '../src/index.js'
import { loadAgentKeypair, LocalKeypairSigner } from 'agentrunner'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} environment variable`)
    process.exit(1)
  }
  return value
}

async function main() {
  const packageId = requireEnv('ACTIONFLOW_PACKAGE_ID')

  let config
  try {
    config = readDaemonConfig()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  let walrusConfig
  try {
    walrusConfig = readWalrusConfig()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  // loadAgentKeypair reads AGENTRUNNER_PRIVATE_KEY
  const keypair = loadAgentKeypair()
  const signer = new LocalKeypairSigner(keypair)

  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())

  const onLog = (record: LogRecord) => process.stdout.write(JSON.stringify(record) + '\n')

  const policyIdsEnv = process.env.POLICYLOOP_POLICY_IDS

  if (policyIdsEnv) {
    // Multi-policy mode
    const policyIds = policyIdsEnv.split(',').map((s) => s.trim()).filter(Boolean)

    if (policyIds.length === 0) {
      console.error('POLICYLOOP_POLICY_IDS must contain at least one policy ID')
      process.exit(1)
    }

    if (!walrusConfig) {
      console.error('WALRUS_NETWORK is required in multi-policy mode (set when POLICYLOOP_POLICY_IDS is used)')
      process.exit(1)
    }

    // One uploader instance shared across all policies — WalrusClient is stateless and reusable
    const uploader = new WalrusUploaderImpl({ config: walrusConfig, signer: keypair })
    const scallop = readScallopConfig()
    const ai = readAiConfig()

    const policies: PolicyLoopOptions[] = policyIds.map((policyId) => ({
      policyId,
      packageId,
      walrus: { uploader },
      signer,
      scallop,
      ai,
    }))

    await runMultiPolicyDaemon(policies, config, controller.signal, onLog)
  } else {
    // Single-policy mode (backward compat — unchanged from Phase 2)
    const policyId = requireEnv('ACTIONFLOW_POLICY_ID')

    let walrus: PolicyLoopOptions['walrus']
    let walrusBlobId: string | undefined

    if (walrusConfig) {
      walrus = { uploader: new WalrusUploaderImpl({ config: walrusConfig, signer: keypair }) }
    } else {
      walrusBlobId = requireEnv('ACTIONFLOW_WALRUS_BLOB_ID')
    }

    const policyOpts: PolicyLoopOptions = {
      policyId,
      packageId,
      walrusBlobId,
      walrus,
      signer,
      scallop: readScallopConfig(),
      ai: readAiConfig(),
    }

    await runDaemon(policyOpts, config, controller.signal, onLog)
    // Node exits naturally — no process.exit(0)
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
