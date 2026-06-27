import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDaemonConfig, readWalrusConfig } from './config.js'

describe('readDaemonConfig', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns defaults when env vars are absent', () => {
    const config = readDaemonConfig()
    expect(config.intervalMs).toBe(60_000)
    expect(config.maxErrorDelayMs).toBe(180_000) // 60_000 * 3
  })

  it('throws when POLICYLOOP_INTERVAL_MS is zero', () => {
    vi.stubEnv('POLICYLOOP_INTERVAL_MS', '0')
    expect(() => readDaemonConfig()).toThrow('POLICYLOOP_INTERVAL_MS')
  })

  it('throws when POLICYLOOP_MAX_ERROR_DELAY_MS is less than intervalMs', () => {
    vi.stubEnv('POLICYLOOP_INTERVAL_MS', '5000')
    vi.stubEnv('POLICYLOOP_MAX_ERROR_DELAY_MS', '4999')
    expect(() => readDaemonConfig()).toThrow('POLICYLOOP_MAX_ERROR_DELAY_MS')
  })

  it('throws when POLICYLOOP_INTERVAL_MS is a non-numeric string', () => {
    vi.stubEnv('POLICYLOOP_INTERVAL_MS', 'abc')
    expect(() => readDaemonConfig()).toThrow('POLICYLOOP_INTERVAL_MS')
  })

  it('throws when POLICYLOOP_MAX_ERROR_DELAY_MS is a non-numeric string', () => {
    vi.stubEnv('POLICYLOOP_INTERVAL_MS', '1000')
    vi.stubEnv('POLICYLOOP_MAX_ERROR_DELAY_MS', 'xyz')
    expect(() => readDaemonConfig()).toThrow('POLICYLOOP_MAX_ERROR_DELAY_MS')
  })

  it('accepts valid custom values', () => {
    vi.stubEnv('POLICYLOOP_INTERVAL_MS', '5000')
    vi.stubEnv('POLICYLOOP_MAX_ERROR_DELAY_MS', '15000')
    const config = readDaemonConfig()
    expect(config.intervalMs).toBe(5000)
    expect(config.maxErrorDelayMs).toBe(15000)
  })
})

describe('readWalrusConfig', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('returns undefined when WALRUS_NETWORK is not set', () => {
    expect(readWalrusConfig()).toBeUndefined()
  })

  it('returns { network: "testnet" } when WALRUS_NETWORK=testnet', () => {
    vi.stubEnv('WALRUS_NETWORK', 'testnet')
    expect(readWalrusConfig()).toEqual({ network: 'testnet' })
  })

  it('returns { network: "mainnet" } when WALRUS_NETWORK=mainnet', () => {
    vi.stubEnv('WALRUS_NETWORK', 'mainnet')
    expect(readWalrusConfig()).toEqual({ network: 'mainnet' })
  })

  it('throws when WALRUS_NETWORK is an invalid value', () => {
    vi.stubEnv('WALRUS_NETWORK', 'local')
    expect(() => readWalrusConfig()).toThrow("WALRUS_NETWORK must be 'testnet' or 'mainnet'")
  })
})
