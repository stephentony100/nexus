import { useState, useEffect } from 'react'
import type { ApiClient, RunCycleResult } from '../api.js'
import { runCycle } from '../api.js'

interface Props {
  client: ApiClient
  policyIds: string[]
}

type PolicyStatus =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: RunCycleResult }
  | { status: 'done'; error: string }

function truncateId(id: string): string {
  if (id.length <= 16) return id
  return `${id.slice(0, 10)}...${id.slice(-6)}`
}

export function PolicyRunner({ client, policyIds }: Props) {
  const [policyStates, setPolicyStates] = useState<Map<string, PolicyStatus>>(
    () => new Map(policyIds.map((id) => [id, { status: 'idle' }]))
  )
  const [lastResult, setLastResult] = useState<RunCycleResult | null>(null)

  // Sync new policyIds into state when the prop changes
  useEffect(() => {
    setPolicyStates((prev) => {
      const next = new Map(prev)
      let changed = false
      for (const id of policyIds) {
        if (!next.has(id)) {
          next.set(id, { status: 'idle' })
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [policyIds])

  async function handleRunCycle(policyId: string) {
    setPolicyStates((prev) => {
      const next = new Map(prev)
      next.set(policyId, { status: 'running' })
      return next
    })

    try {
      const result = await runCycle(client, policyId)
      setLastResult(result)
      setPolicyStates((prev) => {
        const next = new Map(prev)
        next.set(policyId, { status: 'done', result })
        return next
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setPolicyStates((prev) => {
        const next = new Map(prev)
        next.set(policyId, { status: 'done', error: message })
        return next
      })
    }
  }

  function renderChip(state: PolicyStatus) {
    if (state.status === 'idle') return null
    if (state.status === 'running') return <span style={{ marginLeft: 8 }}>⏳</span>
    if ('error' in state) {
      return <span style={{ marginLeft: 8, color: '#c00' }}>✗ error: {state.error}</span>
    }
    const result = state.result
    if (result.ok) {
      return <span style={{ marginLeft: 8, color: '#060' }}>✓ {result.status}</span>
    }
    return <span style={{ marginLeft: 8, color: '#c00' }}>✗ {result.status}</span>
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>Policy Runner</h2>
      {policyIds.length === 0 ? (
        <p style={{ color: '#666' }}>No policy IDs configured. Add them in Settings above.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {policyIds.map((id) => {
            const state = policyStates.get(id) ?? { status: 'idle' }
            const isRunning = state.status === 'running'
            return (
              <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <code style={{ flex: 1, fontSize: 13 }}>{truncateId(id)}</code>
                <button
                  onClick={() => void handleRunCycle(id)}
                  disabled={isRunning}
                  style={{
                    padding: '4px 12px',
                    cursor: isRunning ? 'not-allowed' : 'pointer',
                    fontFamily: 'monospace',
                    opacity: isRunning ? 0.6 : 1,
                  }}
                >
                  Run Cycle
                </button>
                {renderChip(state)}
              </div>
            )
          })}
        </div>
      )}
      {lastResult !== null && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ marginBottom: 8 }}>Last Result</h3>
          <pre
            style={{
              background: '#f4f4f4',
              padding: 16,
              overflow: 'auto',
              fontSize: 13,
              borderRadius: 4,
            }}
          >
            {JSON.stringify(lastResult, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
