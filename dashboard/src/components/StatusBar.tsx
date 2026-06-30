import { useState, useEffect } from 'react'
import type { ApiClient } from '../api.js'
import { getLive, getHealth, getVersion } from '../api.js'

interface Props {
  client: ApiClient
}

interface StatusState {
  live: 'loading' | 'ok' | 'error'
  health: 'loading' | 'ok' | 'error'
  version: string
}

export function StatusBar({ client }: Props) {
  const [status, setStatus] = useState<StatusState>({
    live: 'loading',
    health: 'loading',
    version: 'loading',
  })

  async function refresh() {
    setStatus({ live: 'loading', health: 'loading', version: 'loading' })

    const [liveResult, healthResult, versionResult] = await Promise.allSettled([
      getLive(client.baseUrl),
      getHealth(client),
      getVersion(client),
    ])

    setStatus({
      live: liveResult.status === 'fulfilled' ? 'ok' : 'error',
      health: healthResult.status === 'fulfilled' ? 'ok' : 'error',
      version:
        versionResult.status === 'fulfilled' ? versionResult.value.version : 'unknown',
    })
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.baseUrl, client.apiKey])

  function dot(state: 'loading' | 'ok' | 'error') {
    if (state === 'loading') return '○'
    if (state === 'ok') return '●'
    return '✕'
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <span>
        {dot(status.live)} /live: {status.live === 'loading' ? '…' : status.live}
      </span>
      <span>
        {dot(status.health)} /health: {status.health === 'loading' ? '…' : status.health}
      </span>
      <span>
        version: {status.version}
      </span>
      <button
        onClick={() => void refresh()}
        style={{ padding: '4px 12px', cursor: 'pointer', fontFamily: 'monospace' }}
      >
        Refresh
      </button>
    </div>
  )
}
