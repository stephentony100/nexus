import Anthropic from '@anthropic-ai/sdk'
import type { ScallopConfig } from 'actionflow'
import type { WalrusClientConfig } from './walrus.js'

export interface DaemonConfig {
  intervalMs: number
  maxErrorDelayMs: number
}

export function readScallopConfig(): ScallopConfig | undefined {
  const versionObjectId = process.env.SCALLOP_VERSION_OBJECT_ID
  const marketObjectId = process.env.SCALLOP_MARKET_OBJECT_ID
  if (!versionObjectId || !marketObjectId) {
    return undefined
  }
  return {
    versionObjectId,
    marketObjectId,
    versionInitialSharedVersion: process.env.SCALLOP_VERSION_INITIAL_SHARED_VERSION,
    marketInitialSharedVersion: process.env.SCALLOP_MARKET_INITIAL_SHARED_VERSION,
  }
}

export function readAiConfig():
  | { client: Anthropic; marketContext?: string; throwOnAiFailure: boolean }
  | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.warn('ANTHROPIC_API_KEY not set — running in legacy (deterministic) mode')
    return undefined
  }
  return {
    client: new Anthropic({ apiKey }),
    marketContext: process.env.POLICYLOOP_MARKET_CONTEXT,
    throwOnAiFailure: process.env.POLICYLOOP_THROW_ON_AI_FAILURE === 'true',
  }
}

export function readDaemonConfig(): DaemonConfig {
  const rawInterval = process.env.POLICYLOOP_INTERVAL_MS
  const intervalMs = rawInterval !== undefined ? Number(rawInterval) : 60_000
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `POLICYLOOP_INTERVAL_MS must be a positive finite number (got: ${rawInterval ?? 'unset, default 60000'})`,
    )
  }

  const rawMaxError = process.env.POLICYLOOP_MAX_ERROR_DELAY_MS
  const maxErrorDelayMs = rawMaxError !== undefined ? Number(rawMaxError) : intervalMs * 3
  if (!Number.isFinite(maxErrorDelayMs) || maxErrorDelayMs < intervalMs) {
    throw new Error(
      `POLICYLOOP_MAX_ERROR_DELAY_MS must be a finite number >= intervalMs (got: ${rawMaxError ?? 'unset'})`,
    )
  }

  return { intervalMs, maxErrorDelayMs }
}

export function readWalrusConfig(): WalrusClientConfig | undefined {
  const network = process.env.WALRUS_NETWORK
  if (!network) return undefined
  if (network !== 'testnet' && network !== 'mainnet') {
    throw new Error(`WALRUS_NETWORK must be 'testnet' or 'mainnet' (got: ${network})`)
  }
  return { network }
}
