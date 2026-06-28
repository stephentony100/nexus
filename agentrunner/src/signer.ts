import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

export function loadAgentKeypair(): Ed25519Keypair {
  const secretKey = process.env.AGENTRUNNER_PRIVATE_KEY
  if (!secretKey) {
    throw new Error('Missing AGENTRUNNER_PRIVATE_KEY environment variable')
  }
  return Ed25519Keypair.fromSecretKey(secretKey)
}

export interface TransactionSigner {
  toSuiAddress(): string
  signTransaction(bytes: Uint8Array): Promise<{ signature: string; bytes: string }>
}

export class LocalKeypairSigner implements TransactionSigner {
  constructor(private readonly keypair: Ed25519Keypair) {}

  toSuiAddress(): string {
    return this.keypair.toSuiAddress()
  }

  signTransaction(bytes: Uint8Array): Promise<{ signature: string; bytes: string }> {
    return this.keypair.signTransaction(bytes)
  }
}

export function createLocalSigner(): LocalKeypairSigner {
  return new LocalKeypairSigner(loadAgentKeypair())
}
