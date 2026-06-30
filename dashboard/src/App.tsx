import { useState } from 'react'
import { loadSettings, saveSettings } from './settings.js'
import type { ApiClient } from './api.js'
import { SettingsPanel } from './components/SettingsPanel.js'
import { StatusBar } from './components/StatusBar.js'
import { PolicyRunner } from './components/PolicyRunner.js'

export default function App() {
  const [settings, setSettings] = useState(loadSettings)

  const client: ApiClient = {
    baseUrl: settings.apiUrl,
    apiKey: settings.apiKey,
  }

  function handleSave(newSettings: typeof settings) {
    saveSettings(newSettings)
    setSettings(newSettings)
  }

  return (
    <div style={{ fontFamily: 'monospace', maxWidth: 800, margin: '0 auto', padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Nexus Operator Dashboard</h1>
      <SettingsPanel initialSettings={settings} onSave={handleSave} />
      <hr style={{ margin: '24px 0' }} />
      <StatusBar client={client} />
      <hr style={{ margin: '24px 0' }} />
      <PolicyRunner client={client} policyIds={settings.policyIds} />
    </div>
  )
}
