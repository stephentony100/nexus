import { afterEach, describe, expect, it } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { loadAgentKeypair } from './signer.js'

const ORIGINAL_ENV = process.env.AGENTRUNNER_PRIVATE_KEY

afterEach(() => {
  if (ORIGINAL_ENV === undefined) {
    delete process.env.AGENTRUNNER_PRIVATE_KEY
  } else {
    process.env.AGENTRUNNER_PRIVATE_KEY = ORIGINAL_ENV
  }
})

describe('loadAgentKeypair', () => {
  it('throws a clear error when AGENTRUNNER_PRIVATE_KEY is unset', () => {
    delete process.env.AGENTRUNNER_PRIVATE_KEY
    expect(() => loadAgentKeypair()).toThrow(/AGENTRUNNER_PRIVATE_KEY/)
  })

  it('decodes a real exported secret key into a keypair with the matching address', () => {
    const generated = Ed25519Keypair.generate()
    process.env.AGENTRUNNER_PRIVATE_KEY = generated.getSecretKey()

    const loaded = loadAgentKeypair()

    expect(loaded.toSuiAddress()).toBe(generated.toSuiAddress())
  })
})
