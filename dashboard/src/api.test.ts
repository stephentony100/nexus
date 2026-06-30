import { afterEach, describe, expect, it, vi } from 'vitest'
import { type ApiClient, getLive, getHealth, runCycle, apiFetch } from './api.js'

function makeMockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    json: () => Promise.resolve(body),
  })
}

describe('api', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('getLive does NOT include X-Api-Key header', async () => {
    const mockFetch = makeMockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', mockFetch)

    await getLive('http://localhost:3000')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit | undefined]
    expect(url).toBe('http://localhost:3000/live')
    // getLive passes no options — no headers object at all
    expect(options).toBeUndefined()
  })

  it('getHealth includes X-Api-Key header', async () => {
    const mockFetch = makeMockFetch(200, { status: 'ok' })
    vi.stubGlobal('fetch', mockFetch)

    const client: ApiClient = { baseUrl: 'http://localhost:3000', apiKey: 'test-key' }
    await getHealth(client)

    expect(mockFetch).toHaveBeenCalledOnce()
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    const headers = options.headers as Record<string, string>
    expect(headers['X-Api-Key']).toBe('test-key')
  })

  it('runCycle sends POST to /policies/:id/run-cycle', async () => {
    const mockFetch = makeMockFetch(200, { ok: true, status: 'skipped', reason: 'no action' })
    vi.stubGlobal('fetch', mockFetch)

    const client: ApiClient = { baseUrl: 'http://localhost:3000', apiKey: 'test-key' }
    await runCycle(client, '0xpolicy123')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/policies/0xpolicy123/run-cycle')
    expect(options.method).toBe('POST')
  })

  it('apiFetch throws on non-200 status (401 Unauthorized)', async () => {
    const mockFetch = makeMockFetch(401, { error: 'Unauthorized' })
    vi.stubGlobal('fetch', mockFetch)

    const client: ApiClient = { baseUrl: 'http://localhost:3000', apiKey: 'bad-key' }
    await expect(getHealth(client)).rejects.toThrow('401 Unauthorized')
  })
})
