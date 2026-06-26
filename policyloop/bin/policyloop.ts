#!/usr/bin/env node
import Anthropic from '@anthropic-ai/sdk'
import { runPolicyCycle } from '../src/index.js'

function readScallopConfig() {
  const versionObjectId = process.env.SCALLOP_VERSION_OBJECT_ID
  const marketObjectId = process.env.SCALLOP_MARKET_OBJECT_ID
  if (!versionObjectId || !marketObjectId) {
    return undefined
  }
  return {
    versionObjectId,
    marketObjectId,
    versionInitialSharedVersion: process.env.SCALLOP_VERSION_INITIAL_SHARED_VERSION,
    marketInitialSharedVersion: process.env.SCALLOP_MARKET_INITIAL_SHARED_VERSION,
  }
}

function readAiConfig() {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — running in legacy (deterministic) mode')
    return undefined
  }
  return {
    client: new Anthropic({ apiKey }),
    marketContext: process.env.POLICYLOOP_MARKET_CONTEXT,
    throwOnAiFailure: process.env.POLICYLOOP_THROW_ON_AI_FAILURE === 'true',
  }
}

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

  const result = await runPolicyCycle({
    policyId,
    packageId,
    walrusBlobId,
    scallop: readScallopConfig(),
    ai: readAiConfig(),
  })

  switch (result.status) {
    case 'skipped':
      console.log(`Skipped: ${result.reason}`)
      return
    case 'succeeded':
      console.log(result.eventKind === 'scallop_sui_supplied' ? 'Scallop SUI supply recorded on-chain:' : 'Action recorded on-chain:')
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
      console.error(`Execution reported success (digest ${result.digest}) but no recognized event was found`)
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
