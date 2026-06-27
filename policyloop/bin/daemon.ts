#!/usr/bin/env node
import { readScallopConfig, readAiConfig, readDaemonConfig } from '../src/config.js'
import { runDaemon } from '../src/daemon.js'
import type { LogRecord } from '../src/daemon.js'
import type { PolicyLoopOptions } from '../src/index.js'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} environment variable`)
    process.exit(1)
  }
  return value
}

async function main() {
  const policyId = requireEnv('ACTIONFLOW_POLICY_ID')
  const packageId = requireEnv('ACTIONFLOW_PACKAGE_ID')
  const walrusBlobId = requireEnv('ACTIONFLOW_WALRUS_BLOB_ID')
  requireEnv('AGENTRUNNER_PRIVATE_KEY') // validates presence only; agentrunner reads it internally

  let config
  try {
    config = readDaemonConfig()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const policyOpts: PolicyLoopOptions = {
    policyId,
    packageId,
    walrusBlobId,
    scallop: readScallopConfig(),
    ai: readAiConfig(),
  }

  const controller = new AbortController()
  process.once('SIGINT', () => controller.abort())
  process.once('SIGTERM', () => controller.abort())

  const onLog = (record: LogRecord) => process.stdout.write(JSON.stringify(record) + '\n')

  await runDaemon(policyOpts, config, controller.signal, onLog)
  // Node exits naturally — no process.exit(0)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
