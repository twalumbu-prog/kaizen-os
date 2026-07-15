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
}

export interface ParsedStatement {
  openingBalance: number | null;
  closingBalance: number | null;
  transactions: Transaction[];
}

export interface ParsedFile {
  label: string;
  fileType: "xlsx" | "pdf" | "csv";
  statement: ParsedStatement;
}

/** A validator turns the parsed uploaded files + configured rules into a result. */
export type Validator = (
  files: ParsedFile[],
  rules: ValidationRule[],
) => ValidationResult;
