#!/usr/bin/env node
import { loadAgentKeypair, LocalKeypairSigner } from 'agentrunner'
import { readScallopConfig, readAiConfig, readWalrusConfig, WalrusUploaderImpl } from 'policyloop'
import { readApiConfig } from '../src/config.js'
import { buildServer } from '../src/server.js'

async function main() {
  let config
  try {
    config = readApiConfig()
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const walrusConfig = readWalrusConfig()
  if (!walrusConfig) {
    console.error('WALRUS_NETWORK is required for the API server')
    process.exit(1)
  }

  const keypair = loadAgentKeypair()
  const signer = new LocalKeypairSigner(keypair)
  const uploader = new WalrusUploaderImpl({ config: walrusConfig, signer: keypair })
  const scallop = readScallopConfig()
  const ai = readAiConfig()

  const PORT = Number(process.env.PORT ?? 3000)
  const HOST = process.env.HOST ?? '127.0.0.1'

  const server = buildServer({ deps: { config, signer, uploader, scallop, ai }, logger: true })
  await server.listen({ port: PORT, host: HOST })
  console.log(`API server listening on ${HOST}:${PORT}`)
}

main().catch((err) => {
  console.error('Unexpected error:', err)
  process.exit(1)
})
