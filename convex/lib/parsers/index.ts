import { parseBankCsv } from "./csv";
import { parseSpreadsheet, type SpreadsheetRole } from "./excel";
import { parseBankPdf } from "./pdf";
import { parseReceiptPdf } from "./receipt";
import { parsePayrollRegister } from "./payrollRegister";
import { parsePayrollExtract } from "./payrollExtract";
import { parseCanteenRecon } from "./canteenRecon";
import { parseCanteenInventory } from "./canteenInventory";
import { parseCanteenReceiptPdf } from "./canteenReceipt";
import type { FileType, ParsedStatement } from "../../validators/types";

/**
 * Dispatches to the right parser for a stored submission file.
 *
 * @param validatorKey  The template's validatorKey — used to pick specialist
 *   parsers when the file is not a generic bank statement (e.g. statutory receipts).
 * @param label         The file's label from the submission — used to distinguish
 *   multiple files of the same type within a single validator (e.g. Register vs Extract).
 */
export async function parseUploadedFile(
  fileType: FileType,
  buffer: ArrayBuffer,
  role: SpreadsheetRole,
  validatorKey?: string,
  label?: string,
): Promise<ParsedStatement> {
  // ── Canteen Sales Recon specialist parsers ───────────────────────────────
  if (validatorKey === "canteenSalesRecon") {
    if (fileType === "pdf") return parseCanteenReceiptPdf(buffer);
    if (fileType === "xlsx") {
      const lbl = (label ?? "").toLowerCase();
      if (/inventor/i.test(lbl)) return parseCanteenInventory(buffer);
      return parseCanteenRecon(buffer); // sales recon, or any other xlsx
    }
  }

  // ── Payroll specialist parsers ────────────────────────────────────────────
  if (validatorKey === "payroll" && fileType === "xlsx") {
    const lbl = (label ?? "").toLowerCase();
    if (lbl.includes("register"))                   return parsePayrollRegister(buffer);
    if (lbl.includes("extract") || lbl.includes("journal")) return parsePayrollExtract(buffer);
  }

  // QuickBooks payroll data is stored as CSV with AccountName,Amount,Type columns.
  if (validatorKey === "payroll" && fileType === "csv") {
    return parsePayrollQbCsv(new TextDecoder().decode(buffer));
  }

  // ── Statutory receipt PDFs ────────────────────────────────────────────────
  if (validatorKey === "statutoryReceipts" && fileType === "pdf") return parseReceiptPdf(buffer);

  // ── Images ────────────────────────────────────────────────────────────────
  // Photos carry no machine-readable figures; only the document-review
  // validators handle them, and those read the raw bytes rather than this.
  if (fileType === "jpg" || fileType === "png") {
    return { openingBalance: null, closingBalance: null, transactions: [] };
  }

  // ── Generic parsers ───────────────────────────────────────────────────────
  if (fileType === "xlsx") return parseSpreadsheet(buffer, role);
  if (fileType === "csv")  return parseBankCsv(new TextDecoder().decode(buffer));
  return await parseBankPdf(buffer);
}

/**
 * Parses the CSV produced by `quickbooks.fetchPayrollJournalEntries`.
 * Format: AccountName,Amount,PostingType
 * Returns a ParsedStatement whose metadata keys are prefixed with "qb_".
 */
function parsePayrollQbCsv(csv: string): ParsedStatement {
  const lines = csv.trim().split("\n");
  const metadata: Record<string, number> = {};

  // Map CSV account names → metadata keys (same keys the payroll validator reads).
  const KEY_MAP: Array<[RegExp, string]> = [
    [/staff.salaries/i,                        "qb_staffSalaries"],
    [/napsa.employer/i,                        "qb_napsaEmployerExpense"],
    [/nhima.employer/i,                        "qb_nhimaEmployerExpense"],
    [/napsa.payable/i,                         "qb_napsaPayable"],
    [/nhima.payable/i,                         "qb_nhimaPayable"],
    [/(net.pay|wages.*salaries).*(control)/i,  "qb_netPayControl"],
  ];

  for (const line of lines.slice(1)) { // skip header
    const parts = line.split(",");
    if (parts.length < 2) continue;
    const acct   = parts[0].trim().replace(/^"|"$/g, "");
    const amount = parseFloat(parts[1]) || 0;
    for (const [pattern, key] of KEY_MAP) {
      if (pattern.test(acct)) {
        metadata[key] = (metadata[key] ?? 0) + amount;
        break;
      }
    }
  }

  return { openingBalance: null, closingBalance: null, transactions: [], metadata };
}
