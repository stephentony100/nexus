export interface PolicyState {
  agent: string
  maxTotalBudget: number
  spentTotal: number
  maxSingleTx: number
  allowedProtocols: string[]
  expiresAtMs: number
  paused: boolean
  revoked: boolean
}

export interface PolicyAction {
  policyId: string
  protocol: string
  amount: number
}

export interface FieldError {
  field: string
  reason: string
}

export type ValidationResult =
  | { ok: true; action: PolicyAction }
  | { ok: false; errors: FieldError[] }

export type TranslateActionResult =
  | { ok: true; action: PolicyAction; ptbBytes: string }
  | { ok: false; errors: FieldError[] }
