const KEYS = {
  apiUrl: 'nexus.apiUrl',
  apiKey: 'nexus.apiKey',
  policyIds: 'nexus.policyIds',
} as const

export interface Settings {
  apiUrl: string
  apiKey: string
  policyIds: string[]
}

export const DEFAULT_SETTINGS: Settings = {
  apiUrl: 'http://localhost:3000',
  apiKey: '',
  policyIds: [],
}

export function loadSettings(): Settings {
  try {
    return {
      apiUrl: localStorage.getItem(KEYS.apiUrl) ?? DEFAULT_SETTINGS.apiUrl,
      apiKey: localStorage.getItem(KEYS.apiKey) ?? DEFAULT_SETTINGS.apiKey,
      policyIds: JSON.parse(localStorage.getItem(KEYS.policyIds) ?? '[]'),
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(KEYS.apiUrl, s.apiUrl)
  localStorage.setItem(KEYS.apiKey, s.apiKey)
  localStorage.setItem(KEYS.policyIds, JSON.stringify(s.policyIds))
}
