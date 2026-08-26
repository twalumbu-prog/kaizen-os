export type ChecklistStatus = "pass" | "fail" | "warning";
export type Severity = "low" | "medium" | "high" | "critical";

export interface ChecklistItem {
  title: string;
  status: ChecklistStatus;
  explanation: string;
  severity: Severity;
  points: number;
  maxPoints: number;
}

export interface ValidationResult {
  score: number;
  checklist: ChecklistItem[];
  summary: string;
  recommendations: string[];
  /** Values this validator wants persisted and handed to the next period's validation run of the same report. */
  carryForward?: { closingBalance?: number };
}

export interface ValidationRule {
  key: string;
  label: string;
  enabled: boolean;
  tolerance?: number;
}

export type TransactionType = "debit" | "credit";

export interface Transaction {
  /** ISO date string (yyyy-mm-dd). */
  date: string;
  description: string;
  amount: number;
  type: TransactionType;
  /** Running balance immediately after this row, when the source file has a balance column. */
  balanceAfter?: number;
}

export interface ParsedStatement {
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: Transaction[];
  /**
   * Arbitrary key-value metadata attached by specialised parsers (e.g. statutory
   * receipt fields like paymentDate, period, receiptNumber).  Generic validators
   * that don't know about this field can safely ignore it.
   */
  metadata?: Record<string, string | number | null>;
}

export interface ParsedFile {
  label: string;
  fileType: "xlsx" | "pdf" | "csv";
  statement: ParsedStatement;
}

/** The report period being validated, and what its opening balance should roll forward from. */
export interface ValidationContext {
  periodStart: number;
  periodEnd: number;
  expectedOpeningBalance: number | null;
}

/** A validator turns the parsed uploaded files + configured rules into a result. */
export type Validator = (
  files: ParsedFile[],
  rules: ValidationRule[],
  context: ValidationContext,
) => ValidationResult | Promise<ValidationResult>;
