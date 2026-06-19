#!/usr/bin/env node
import { runPolicyCycle } from '../src/index.js'

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

  const walrusBlobId = process.env.ACTIONFLOW_WALRUS_BLOB_ID
  if (!walrusBlobId) {
    console.error('Missing ACTIONFLOW_WALRUS_BLOB_ID environment variable')
    process.exit(1)
  }

  if (!process.env.AGENTRUNNER_PRIVATE_KEY) {
    console.error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
    process.exit(1)
  }

  const result = await runPolicyCycle({ policyId, packageId, walrusBlobId })

  switch (result.status) {
    case 'skipped':
      console.log(`Skipped: ${result.reason}`)
      return
    case 'succeeded':
      console.log('Action recorded on-chain:')
      console.log(JSON.stringify(result.event, null, 2))
      console.log(`\nDigest: ${result.digest}`)
      return
    case 'validation_failed':
      console.error('Decided action failed validation:')
      for (const error of result.errors) {
        console.error(`  - ${error.field}: ${error.reason}`)
      }
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
      console.error(`Execution reported success (digest ${result.digest}) but no ActionRecorded event was found`)
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
