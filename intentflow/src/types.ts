export interface PolicyStrategy {
  agentAddress: string
  maxTotalBudget: number
  maxSingleTx: number
  allowedProtocols: string[]
  expiresInDays: number
  expiresAtMs: number
}

export interface FieldError {
  field: string
  reason: string
}

export type ValidationResult =
  | { ok: true; strategy: PolicyStrategy }
  | { ok: false; errors: FieldError[] }

export type TranslateGoalResult =
  | { ok: true; strategy: PolicyStrategy; ptbBytes: string }
  | { ok: false; errors: FieldError[] }
