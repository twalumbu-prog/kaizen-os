export type FileType = "xlsx" | "pdf" | "csv" | "jpg" | "png";

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
  fileType: FileType;
  statement: ParsedStatement;
  /**
   * The file exactly as uploaded, attached only for validators that review the
   * document itself rather than figures extracted from it (see
   * documentSubmission). Omitted for the extraction-based validators.
   */
  raw?: RawFile;
}

export interface RawFile {
  /** Base64 of the original bytes. */
  data: string;
  mimeType: string;
  fileName: string;
  byteLength: number;
}

/** Credentials for validators that call out to a model. */
export interface AiConfig {
  apiKey: string;
  model: string;
}

/** The report period being validated, and what its opening balance should roll forward from. */
export interface ValidationContext {
  periodStart: number;
  periodEnd: number;
  expectedOpeningBalance: number | null;
  /** The report's name, for validators that judge a document against what was asked for. */
  templateName?: string;
  /** Human-readable period, e.g. "Week of 2026-07-10". */
  periodLabel?: string;
  /** What the template asked to be uploaded. */
  requiredFiles?: { label: string; required: boolean }[];
  /** Present when the org has an active AI integration; absent when it does not. */
  ai?: AiConfig;
}

/** A validator turns the parsed uploaded files + configured rules into a result. */
export type Validator = (
  files: ParsedFile[],
  rules: ValidationRule[],
  context: ValidationContext,
) => ValidationResult | Promise<ValidationResult>;
