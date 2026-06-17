#!/usr/bin/env node
import { translateGoal } from '../src/index.js'

async function main() {
  const goal = process.argv.slice(2).join(' ')
  if (!goal) {
    console.error('Usage: intentflow "<goal text>"')
    process.exit(1)
  }

  const packageId = process.env.INTENTFLOW_PACKAGE_ID
  if (!packageId) {
    console.error('Missing INTENTFLOW_PACKAGE_ID environment variable')
    process.exit(1)
  }

  const result = await translateGoal(goal, { packageId })

  if (!result.ok) {
    console.error('Could not build a policy from this goal:')
    for (const error of result.errors) {
      console.error(`  - ${error.field}: ${error.reason}`)
    }
    process.exit(1)
  }

  console.log('Strategy:')
  console.log(JSON.stringify(result.strategy, null, 2))
  console.log('\nPTB (base64):')
  console.log(result.ptbBytes)
}

main().catch((error) => {
  console.error('Unexpected error:', error)
  process.exit(1)
})
