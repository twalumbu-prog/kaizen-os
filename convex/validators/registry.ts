import { bankReconciliationMaxPoints, bankReconciliationValidator } from "./bankReconciliation";
import { statutoryReceiptsMaxPoints, statutoryReceiptsValidator } from "./statutoryReceipts";
import { payrollMaxPoints, payrollValidator } from "./payroll";
import { canteenSalesReconMaxPoints, canteenSalesReconValidator } from "./canteenSalesRecon";
import { documentSubmissionMaxPoints, documentSubmissionValidator } from "./documentSubmission";
import { adPerformanceMaxPoints, adPerformanceValidator } from "./adPerformance";
import { canteenDeviationMaxPoints, canteenDeviationValidator } from "./canteenDeviation";
import { canteenValidChildrenMaxPoints, canteenValidChildrenValidator } from "./canteenValidChildren";
import {
  mew3DepositsValidator,
  mew3DocumentMaxPoints,
  mew3GuestRegisterValidator,
  mew3ReceiptsValidator,
} from "./mew3Documents";
import { mew3DailyReconMaxPoints, mew3DailyReconValidator } from "./mew3DailyRecon";
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
  statutoryReceipts: statutoryReceiptsValidator,
  payroll: payrollValidator,
  canteenSalesRecon: canteenSalesReconValidator,
  documentSubmission: documentSubmissionValidator,
  adPerformance: adPerformanceValidator,
  canteenDeviation: canteenDeviationValidator,
  canteenValidChildren: canteenValidChildrenValidator,
  mew3GuestRegister: mew3GuestRegisterValidator,
  mew3Receipts: mew3ReceiptsValidator,
  mew3Deposits: mew3DepositsValidator,
  mew3DailyRecon: mew3DailyReconValidator,
};

export function getValidator(validatorKey: string): AsyncValidator {
  const validator = VALIDATOR_REGISTRY[validatorKey];
  if (!validator) {
    throw new Error(`No validator registered for key "${validatorKey}"`);
  }
  return validator;
}

type MaxPointsFn = (rules: ValidationRule[]) => number;

/**
 * Maps `reportTemplates.validatorKey` to a function computing the max possible
 * checklist score for a set of rules, without running the validator against files.
 */
export const MAX_POINTS_REGISTRY: Record<string, MaxPointsFn> = {
  bankReconciliation: bankReconciliationMaxPoints,
  statutoryReceipts: statutoryReceiptsMaxPoints,
  payroll: payrollMaxPoints,
  canteenSalesRecon: canteenSalesReconMaxPoints,
  documentSubmission: documentSubmissionMaxPoints,
  adPerformance: adPerformanceMaxPoints,
  canteenDeviation: canteenDeviationMaxPoints,
  canteenValidChildren: canteenValidChildrenMaxPoints,
  mew3GuestRegister: mew3DocumentMaxPoints,
  mew3Receipts: mew3DocumentMaxPoints,
  mew3Deposits: mew3DocumentMaxPoints,
  mew3DailyRecon: mew3DailyReconMaxPoints,
};

export function getMaxPossibleScore(validatorKey: string, rules: ValidationRule[]): number {
  const fn = MAX_POINTS_REGISTRY[validatorKey];
  if (!fn) {
    throw new Error(`No max-points function registered for key "${validatorKey}"`);
  }
  return fn(rules);
}
