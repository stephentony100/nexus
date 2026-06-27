#!/usr/bin/env node
import { readScallopConfig, readAiConfig, readWalrusConfig } from '../src/config.js'
import { WalrusUploaderImpl } from '../src/walrus.js'
import { runPolicyCycle } from '../src/index.js'
import type { PolicyLoopOptions } from '../src/index.js'
import { loadAgentKeypair } from 'agentrunner'

async function main() {
  const policyId = process.env.ACTIONFLOW_POLICY_ID
  if (!policyId) {
    console.error('Missing ACTIONFLOW_POLICY_ID environment variable')
    process.exit(1)
  }

  const packageId = process.env.ACTIONFLOW_PACKAGE_ID
  if (!packageId) {
    console.error('Missing ACTIONFLOW_PACKAGE_ID environment variable')
    process.exit(1)
  }

  if (!process.env.AGENTRUNNER_PRIVATE_KEY) {
    console.error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
    process.exit(1)
  }

  let walrusConfig
  try {
    walrusConfig = readWalrusConfig()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const signer = loadAgentKeypair()

  let walrus: PolicyLoopOptions['walrus']
  let walrusBlobId: string | undefined

  if (walrusConfig) {
    walrus = { uploader: new WalrusUploaderImpl({ config: walrusConfig, signer }) }
  } else {
    const staticBlobId = process.env.ACTIONFLOW_WALRUS_BLOB_ID
    if (!staticBlobId) {
      console.error(
        'Missing ACTIONFLOW_WALRUS_BLOB_ID environment variable (required when WALRUS_NETWORK is not set)',
      )
      process.exit(1)
    }
    walrusBlobId = staticBlobId
  }

  const result = await runPolicyCycle({
    policyId,
    packageId,
    walrusBlobId,
    walrus,
    signer,
    scallop: readScallopConfig(),
    ai: readAiConfig(),
  })

  switch (result.status) {
    case 'skipped':
      console.log(`Skipped: ${result.reason}`)
      return
    case 'succeeded':
      console.log(
        result.eventKind === 'scallop_sui_supplied'
          ? 'Scallop SUI supply recorded on-chain:'
          : 'Action recorded on-chain:',
      )
      console.log(JSON.stringify(result.event, null, 2))
      console.log(`\nDigest: ${result.digest}`)
      return
    case 'upload_failed':
      console.error(`Walrus upload failed: ${result.reason}`)
      process.exit(1)
      return
    case 'unsupported_action':
      console.error(`Action not supported: ${result.reason}`)
      process.exit(1)
      return
    case 'validation_failed':
      console.error('Decided action failed validation:')
      for (const error of result.errors) {
        console.error(`  - ${error.field}: ${error.reason}`)
      }
      process.exit(1)
      return
    case 'config_missing':
      console.error(`Missing configuration: ${result.reason}`)
      process.exit(1)
      return
    case 'simulation_failed':
      console.error(`Simulation rejected this action: ${result.reason}`)
      process.exit(1)
      return
    case 'execution_aborted':
      console.error(`Execution aborted on-chain (digest ${result.digest}): ${result.reason}`)
      process.exit(1)
      return
    case 'event_missing':
      console.error(
        `Execution reported success (digest ${result.digest}) but no recognized event was found`,
      )
      process.exit(1)
      return
    case 'submission_failed':
      console.error(`Submission failed during ${result.stage}: ${result.reason}`)
      process.exit(1)
      return
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
