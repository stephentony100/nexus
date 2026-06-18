import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

export function loadAgentKeypair(): Ed25519Keypair {
  const secretKey = process.env.AGENTRUNNER_PRIVATE_KEY
  if (!secretKey) {
    throw new Error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
  }
  return Ed25519Keypair.fromSecretKey(secretKey)
}
