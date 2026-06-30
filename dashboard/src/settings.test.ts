import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from './settings.js'

describe('settings', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('loadSettings returns DEFAULT_SETTINGS when localStorage is empty', () => {
    const s = loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })

  it('loadSettings returns saved values after saveSettings', () => {
    const saved = {
      apiUrl: 'http://example.com:4000',
      apiKey: 'secret-key',
      policyIds: ['0xaaa', '0xbbb'],
    }
    saveSettings(saved)
    expect(loadSettings()).toEqual(saved)
  })

  it('saveSettings overwrites previously saved values', () => {
    saveSettings({ apiUrl: 'http://first.com', apiKey: 'first-key', policyIds: ['0x111'] })
    saveSettings({ apiUrl: 'http://second.com', apiKey: 'second-key', policyIds: ['0x222'] })
    const s = loadSettings()
    expect(s.apiUrl).toBe('http://second.com')
    expect(s.apiKey).toBe('second-key')
    expect(s.policyIds).toEqual(['0x222'])
  })

  it('loadSettings returns DEFAULT_SETTINGS when localStorage contains malformed JSON for policyIds', () => {
    localStorage.setItem('nexus.policyIds', 'not-valid-json{{{')
    const s = loadSettings()
    expect(s).toEqual(DEFAULT_SETTINGS)
  })
})
