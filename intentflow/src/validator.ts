import type { RawStrategy } from './extractor.js'
import type { FieldError, PolicyStrategy, ValidationResult } from './types.js'

const MS_PER_DAY = 86_400_000
const SUI_ADDRESS_PATTERN = /^0x[0-9a-fA-F]{1,64}$/

export function validateStrategy(raw: RawStrategy, nowMs: number): ValidationResult {
  const errors: FieldError[] = []

  if (raw.agentAddress === null) {
    errors.push({ field: 'agentAddress', reason: 'not specified in goal' })
  }
  if (raw.maxTotalBudget === null) {
    errors.push({ field: 'maxTotalBudget', reason: 'not specified in goal' })
  }
  if (raw.maxSingleTx === null) {
    errors.push({ field: 'maxSingleTx', reason: 'not specified in goal' })
  }
  if (raw.allowedProtocols === null) {
    errors.push({ field: 'allowedProtocols', reason: 'not specified in goal' })
  }
  if (raw.expiresInDays === null) {
    errors.push({ field: 'expiresInDays', reason: 'not specified in goal' })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const agentAddress = raw.agentAddress as string
  const maxTotalBudget = raw.maxTotalBudget as number
  const maxSingleTx = raw.maxSingleTx as number
  const allowedProtocols = raw.allowedProtocols as string[]
  const expiresInDays = raw.expiresInDays as number

  if (!SUI_ADDRESS_PATTERN.test(agentAddress)) {
    errors.push({ field: 'agentAddress', reason: `"${agentAddress}" is not a valid Sui address` })
  }
  if (maxTotalBudget <= 0) {
    errors.push({ field: 'maxTotalBudget', reason: `must be greater than 0, got ${maxTotalBudget}` })
  }
  if (maxSingleTx <= 0) {
    errors.push({ field: 'maxSingleTx', reason: `must be greater than 0, got ${maxSingleTx}` })
  } else if (maxSingleTx > maxTotalBudget) {
    errors.push({
      field: 'maxSingleTx',
      reason: `maxSingleTx (${maxSingleTx}) exceeds maxTotalBudget (${maxTotalBudget})`,
    })
  }
  if (allowedProtocols.length === 0) {
    errors.push({ field: 'allowedProtocols', reason: 'must name at least one protocol' })
  }
  if (expiresInDays <= 0) {
    errors.push({ field: 'expiresInDays', reason: `must be greater than 0, got ${expiresInDays}` })
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const strategy: PolicyStrategy = {
    agentAddress,
    maxTotalBudget,
    maxSingleTx,
    allowedProtocols,
    expiresInDays,
    expiresAtMs: nowMs + expiresInDays * MS_PER_DAY,
  }

  return { ok: true, strategy }
}
