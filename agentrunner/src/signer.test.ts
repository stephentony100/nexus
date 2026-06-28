import { afterEach, describe, expect, it } from 'vitest'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { loadAgentKeypair, LocalKeypairSigner, createLocalSigner } from './signer.js'

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

describe('LocalKeypairSigner', () => {
  it('toSuiAddress() returns the same address as the underlying keypair', () => {
    const keypair = Ed25519Keypair.generate()
    const signer = new LocalKeypairSigner(keypair)

    expect(signer.toSuiAddress()).toBe(keypair.toSuiAddress())
  })

  it('signTransaction() resolves to an object with signature and bytes strings', async () => {
    const keypair = Ed25519Keypair.generate()
    const signer = new LocalKeypairSigner(keypair)
    const bytes = new Uint8Array([1, 2, 3, 4])

    const result = await signer.signTransaction(bytes)

    expect(typeof result.signature).toBe('string')
    expect(typeof result.bytes).toBe('string')
  })
})

describe('createLocalSigner', () => {
  it('returns a LocalKeypairSigner with the correct address when AGENTRUNNER_PRIVATE_KEY is set', () => {
    const keypair = Ed25519Keypair.generate()
    process.env.AGENTRUNNER_PRIVATE_KEY = keypair.getSecretKey()

    const signer = createLocalSigner()

    expect(signer).toBeInstanceOf(LocalKeypairSigner)
    expect(signer.toSuiAddress()).toBe(keypair.toSuiAddress())
  })

  it('throws matching /AGENTRUNNER_PRIVATE_KEY/ when env var is unset', () => {
    delete process.env.AGENTRUNNER_PRIVATE_KEY

    expect(() => createLocalSigner()).toThrow(/AGENTRUNNER_PRIVATE_KEY/)
  })
})
