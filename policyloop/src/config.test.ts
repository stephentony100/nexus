import { afterEach, describe, expect, it, vi } from 'vitest'
import { readDaemonConfig } from './config.js'

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
