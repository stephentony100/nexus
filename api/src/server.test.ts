import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { type FastifyInstance } from 'fastify'
import type { ApiConfig } from './config.js'
import { runPolicyCycle } from 'policyloop'

vi.mock('policyloop', () => ({ runPolicyCycle: vi.fn() }))

// Defer import of buildServer so the mock is in place first
const { buildServer } = await import('./server.js')

const TEST_KEY = 'test-secret'
const POLICY_ID = '0x' + 'aa'.repeat(32)
const PACKAGE_ID = '0x' + '11'.repeat(32)

const testConfig: ApiConfig = {
  secretKey: TEST_KEY,
  allowedPolicyIds: new Set([POLICY_ID]),
  packageId: PACKAGE_ID,
}

const mockSigner = { toSuiAddress: vi.fn().mockReturnValue('0xagent'), signTransaction: vi.fn() }
const mockUploader = { uploadJson: vi.fn() }

let server: FastifyInstance

describe('HTTP API server', () => {
  beforeAll(async () => {
    // Build server once per suite; Fastify inject does not require listen()
    server = await buildServer({
      deps: {
        config: testConfig,
        signer: mockSigner as any,
        uploader: mockUploader as any,
      },
    })
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('GET /health with valid key → 200, { status: "ok" }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-api-key': TEST_KEY },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('GET /version with valid key → 200, { version: "0.1.0" }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/version',
      headers: { 'x-api-key': TEST_KEY },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ version: '0.1.0' })
  })

  it('GET /health missing X-Api-Key → 401, { error: "unauthorized" }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/health',
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('GET /health wrong X-Api-Key → 401, { error: "unauthorized" }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-api-key': 'wrong-key' },
    })
    expect(res.statusCode).toBe(401)
    expect(res.json()).toEqual({ error: 'unauthorized' })
  })

  it('POST /policies/:id/run-cycle non-allowlisted ID → 403', async () => {
    const badId = '0x' + 'bb'.repeat(32)
    const res = await server.inject({
      method: 'POST',
      url: `/policies/${badId}/run-cycle`,
      headers: { 'x-api-key': TEST_KEY },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toEqual({ error: 'policy_not_allowed', policyId: badId })
  })

  it('POST /policies/:id/run-cycle valid ID → 200, returns PolicyLoopResult', async () => {
    const mockResult = { ok: true, status: 'skipped', reason: 'not due yet' }
    vi.mocked(runPolicyCycle).mockResolvedValueOnce(mockResult as any)

    const res = await server.inject({
      method: 'POST',
      url: `/policies/${POLICY_ID}/run-cycle`,
      headers: { 'x-api-key': TEST_KEY },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(mockResult)
  })

  it('POST /policies/:id/run-cycle → runPolicyCycle called with correct args', async () => {
    vi.mocked(runPolicyCycle).mockResolvedValueOnce({
      ok: true,
      status: 'skipped',
      reason: 'test',
    } as any)

    await server.inject({
      method: 'POST',
      url: `/policies/${POLICY_ID}/run-cycle`,
      headers: { 'x-api-key': TEST_KEY },
    })

    expect(runPolicyCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        policyId: POLICY_ID,
        packageId: PACKAGE_ID,
      }),
    )
    const call = vi.mocked(runPolicyCycle).mock.calls[0][0]
    expect(call.walrus?.uploader).toBe(mockUploader)
    expect(call.signer).toBe(mockSigner)
  })

  it('POST /policies/:id/run-cycle when runPolicyCycle throws → 500', async () => {
    vi.mocked(runPolicyCycle).mockRejectedValueOnce(new Error('unexpected failure'))

    const res = await server.inject({
      method: 'POST',
      url: `/policies/${POLICY_ID}/run-cycle`,
      headers: { 'x-api-key': TEST_KEY },
    })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'internal_error' })
  })

  it('GET /live with no X-Api-Key → 200, { status: "ok" }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/live',
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('GET /live with wrong X-Api-Key → 200, { status: "ok" }', async () => {
    const res = await server.inject({
      method: 'GET',
      url: '/live',
      headers: { 'x-api-key': 'wrong-key' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })
})
