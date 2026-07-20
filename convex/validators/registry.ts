import { bankReconciliationValidator } from "./bankReconciliation";
import type { ParsedFile, ValidationContext, ValidationResult, ValidationRule } from "./types";

type AsyncValidator = (
  files: ParsedFile[],
  rules: ValidationRule[],
  context: ValidationContext,
) => Promise<ValidationResult>;

/**
 * Maps `reportTemplates.validatorKey` to its validator implementation.
 * Add new report types here without touching any call sites.
 */
export const VALIDATOR_REGISTRY: Record<string, AsyncValidator> = {
  bankReconciliation: bankReconciliationValidator,
};

export function getValidator(validatorKey: string): AsyncValidator {
  const validator = VALIDATOR_REGISTRY[validatorKey];
  if (!validator) {
    throw new Error(`No validator registered for key "${validatorKey}"`);
  }
  return validator;
}
