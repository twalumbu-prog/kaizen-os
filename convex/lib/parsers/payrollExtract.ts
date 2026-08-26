/**
 * Payroll Journal Extract XLSX parser.
 *
 * Reads the accounting journal extract and returns the debit/credit amounts
 * for the key payroll accounts.  Account names are matched with fuzzy keyword
 * logic so minor naming differences (e.g. "wages & salaries control" vs
 * "net pay control account") don't break the parse.
 */

import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

export interface PayrollExtractTotals {
  staffSalaries: number;            // Debit — gross pay expense
  napsaEmployerExpense: number;     // Debit — employer NAPSA contribution expense
  nhimaEmployerExpense: number;     // Debit — employer NHIMA contribution expense
  napsaPayable: number;             // Credit — total NAPSA payable (employer + employee)
  nhimaPayable: number;             // Credit — total NHIMA payable (employer + employee)
  zraTaxPayable: number;            // Credit — PAYE liability
  staffDeductionsControl: number;   // Credit — non-statutory staff deductions
  netPayControl: number;            // Credit — net pay / wages & salaries control
  totalDebits: number;
  totalCredits: number;
}

type CellValue = string | number | boolean | Date | null | undefined;

function num(v: CellValue): number {
  if (v === null || v === undefined || v === "" || v === false) return 0;
  if (typeof v === "number") return v;
  if (v instanceof Date) return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Case-insensitive keyword search across an account name string. */
function matches(accountName: string, ...keywords: string[]): boolean {
  const lower = accountName.toLowerCase();
  return keywords.every((kw) => lower.includes(kw.toLowerCase()));
}

export function parsePayrollExtract(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header: 1 means first row becomes object keys
  const rows: Record<string, CellValue>[] = XLSX.utils.sheet_to_json(ws, {
    defval: null,
    blankrows: false,
  });

  if (rows.length === 0) throw new Error("Payroll Journal Extract appears to be empty");

  // Discover the AccountName, Debits, Credits column keys (tolerant of casing).
  const firstRow = rows[0];
  let acctKey = "AccountName";
  let debitKey = "Debits";
  let creditKey = "Credits";
  for (const key of Object.keys(firstRow)) {
    const norm = key.toLowerCase().replace(/\s/g, "");
    if (norm === "accountname") acctKey = key;
    else if (norm === "debits" || norm === "debit") debitKey = key;
    else if (norm === "credits" || norm === "credit") creditKey = key;
  }

  const totals: PayrollExtractTotals = {
    staffSalaries: 0,
    napsaEmployerExpense: 0,
    nhimaEmployerExpense: 0,
    napsaPayable: 0,
    nhimaPayable: 0,
    zraTaxPayable: 0,
    staffDeductionsControl: 0,
    netPayControl: 0,
    totalDebits: 0,
    totalCredits: 0,
  };

  for (const row of rows) {
    const acct = String(row[acctKey] ?? "").trim();
    const debit = num(row[debitKey]);
    const credit = num(row[creditKey]);

    if (!acct) continue;

    // Accumulate grand totals (the last row in the extract is the total line).
    totals.totalDebits  += debit;
    totals.totalCredits += credit;

    // ── Match individual payroll line items ───────────────────────────────
    if (matches(acct, "staff", "salaries") && !matches(acct, "control", "deduction")) {
      totals.staffSalaries = debit || totals.staffSalaries;
    } else if (matches(acct, "napsa") && matches(acct, "employer") && matches(acct, "expense", "contribution")) {
      totals.napsaEmployerExpense = debit || totals.napsaEmployerExpense;
    } else if (matches(acct, "nhima") && matches(acct, "employer") && matches(acct, "expense", "contribution")) {
      totals.nhimaEmployerExpense = debit || totals.nhimaEmployerExpense;
    } else if (matches(acct, "napsa") && matches(acct, "payable")) {
      totals.napsaPayable = credit || totals.napsaPayable;
    } else if (matches(acct, "nhima") && matches(acct, "payable")) {
      totals.nhimaPayable = credit || totals.nhimaPayable;
    } else if (matches(acct, "zra") || (matches(acct, "tax") && matches(acct, "payable")) || matches(acct, "paye")) {
      totals.zraTaxPayable = credit || totals.zraTaxPayable;
    } else if (matches(acct, "deductions") && matches(acct, "control")) {
      totals.staffDeductionsControl = credit || totals.staffDeductionsControl;
    } else if (
      (matches(acct, "net", "pay") || matches(acct, "wages") || matches(acct, "salaries")) &&
      matches(acct, "control")
    ) {
      totals.netPayControl = credit || totals.netPayControl;
    }
  }

  return {
    openingBalance: null,
    closingBalance: null,
    transactions: [],
    metadata: totals as unknown as Record<string, string | number | null>,
  };
}
