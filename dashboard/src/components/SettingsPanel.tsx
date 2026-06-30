import { useState } from 'react'
import type { Settings } from '../settings.js'

interface Props {
  initialSettings: Settings
  onSave: (s: Settings) => void
}

export function SettingsPanel({ initialSettings, onSave }: Props) {
  const [apiUrl, setApiUrl] = useState(initialSettings.apiUrl)
  const [apiKey, setApiKey] = useState(initialSettings.apiKey)
  const [policyIdsText, setPolicyIdsText] = useState(initialSettings.policyIds.join('\n'))

  function handleSave() {
    const policyIds = policyIdsText
      .split(/[\n,]/)
      .map((id) => id.trim())
      .filter((id) => id.length > 0)

    onSave({ apiUrl, apiKey, policyIds })
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Settings</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>API URL</span>
          <input
            type="text"
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 14 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>API Key</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 14 }}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span>Policy IDs (one per line or comma-separated)</span>
          <textarea
            value={policyIdsText}
            onChange={(e) => setPolicyIdsText(e.target.value)}
            rows={4}
            style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 14, resize: 'vertical' }}
          />
        </label>
        <div>
          <button
            onClick={handleSave}
            style={{ padding: '8px 16px', cursor: 'pointer', fontFamily: 'monospace' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
