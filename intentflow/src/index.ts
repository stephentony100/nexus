import Anthropic from '@anthropic-ai/sdk'
import { extractStrategy, ExtractionRefusedError } from './extractor.js'
import type { RawStrategy } from './extractor.js'
import { validateStrategy } from './validator.js'
import { buildCreatePolicyPtb } from './ptbBuilder.js'
import type { TranslateGoalResult } from './types.js'

export interface TranslateGoalOptions {
  packageId: string
  client?: Anthropic
}

export async function translateGoal(
  goal: string,
  opts: TranslateGoalOptions,
): Promise<TranslateGoalResult> {
  const client = opts.client ?? new Anthropic()

  let raw: RawStrategy
  try {
    raw = await extractStrategy(goal, client)
  } catch (error) {
    if (error instanceof ExtractionRefusedError) {
      return { ok: false, errors: [{ field: '_root', reason: 'could not parse goal' }] }
    }
    throw error
  }

  const validated = validateStrategy(raw, Date.now())
  if (!validated.ok) {
    return validated
  }

  const tx = buildCreatePolicyPtb(validated.strategy, opts.packageId)
  const bytes = await tx.build({ onlyTransactionKind: true })
  const ptbBytes = Buffer.from(bytes).toString('base64')

  return { ok: true, strategy: validated.strategy, ptbBytes }
}

export { extractStrategy, ExtractionRefusedError } from './extractor.js'
export { validateStrategy } from './validator.js'
export { buildCreatePolicyPtb } from './ptbBuilder.js'
export type { RawStrategy } from './extractor.js'
export type { PolicyStrategy, FieldError, ValidationResult, TranslateGoalResult } from './types.js'
