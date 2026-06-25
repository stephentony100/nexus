#!/usr/bin/env node
import { translateAction } from '../src/index.js'

async function main() {
  const goal = process.argv.slice(2).join(' ')
  if (!goal) {
    console.error('Usage: actionflow "<goal text>"')
    process.exit(1)
  }

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

  const result = await translateAction(goal, { policyId, packageId, walrusBlobId })

  if (!result.ok) {
    if ('errors' in result) {
      console.error('Could not build an action from this goal:')
      for (const error of result.errors) {
        console.error(`  - ${error.field}: ${error.reason}`)
      }
    } else {
      console.error(`Could not build an action from this goal: ${result.reason}`)
    }
    process.exit(1)
  }

  console.log('Action:')
  console.log(JSON.stringify(result.action, null, 2))
  console.log('\nPTB (base64):')
  console.log(result.ptbBytes)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
