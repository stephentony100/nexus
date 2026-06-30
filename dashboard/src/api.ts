export interface ApiClient {
  baseUrl: string
  apiKey: string
}

export interface LiveResult { status: 'ok' }
export interface HealthResult { status: 'ok' }
export interface VersionResult { version: string }

// PolicyLoopResult union — mirror of policyloop types (no import — avoid cross-package dep)
export type RunCycleResult =
  | { ok: true; status: 'skipped'; reason: string }
  | { ok: true; status: 'succeeded'; digest: string; eventKind: string; event: Record<string, unknown> }
  | { ok: false; status: string; reason?: string; errors?: unknown[] }

export async function apiFetch<T>(client: ApiClient, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${client.baseUrl}${path}`, {
    ...options,
    headers: {
      'X-Api-Key': client.apiKey,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })
  if (!res.ok && res.status !== 200) {
    throw new Error(`${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export async function getLive(baseUrl: string): Promise<LiveResult> {
  const res = await fetch(`${baseUrl}/live`)
  return res.json() as Promise<LiveResult>
}

export async function getHealth(client: ApiClient): Promise<HealthResult> {
  return apiFetch<HealthResult>(client, '/health')
}

export async function getVersion(client: ApiClient): Promise<VersionResult> {
  return apiFetch<VersionResult>(client, '/version')
}

export async function runCycle(client: ApiClient, policyId: string): Promise<RunCycleResult> {
  return apiFetch<RunCycleResult>(client, `/policies/${policyId}/run-cycle`, { method: 'POST' })
}
