export interface ApiConfig {
  secretKey: string
  allowedPolicyIds: Set<string>
  packageId: string
}

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing ${name} environment variable`)
  return v
}

export function readApiConfig(): ApiConfig {
  const secretKey = requireEnv('API_SECRET_KEY')
  const rawIds = requireEnv('API_ALLOWED_POLICY_IDS')
  const allowedPolicyIds = new Set(
    rawIds.split(',').map((s) => s.trim()).filter(Boolean),
  )
  if (allowedPolicyIds.size === 0) {
    throw new Error('API_ALLOWED_POLICY_IDS must contain at least one policy ID')
  }
  const packageId = requireEnv('ACTIONFLOW_PACKAGE_ID')
  return { secretKey, allowedPolicyIds, packageId }
}
