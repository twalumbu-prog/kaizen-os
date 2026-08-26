/**
 * Payroll Register XLSX parser.
 *
 * Extracts the TOTAL row from the TEC payroll register template.
 * Column layout (0-indexed):
 *   0  Employee ID | 1  Name | 2  Basic Pay | 3  Staff Welfare | 4  Professional
 *   5  Responsibility | 6  Total O.T Pay | 7  Bonus | 8  Gross Pay
 *   9  NAPSA | 10  NHIMA | 11  PAYE | 12  School Fees | 13  Salary Advance
 *   14  Staff Loans | 15  Other Deductions | 16  Total Deductions | 17  Net Pay
 *
 * The parser is column-name-aware: it scans header rows for known keywords so
 * it can survive minor template changes (added income columns, reordering, etc.).
 */

import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

export interface PayrollRegisterTotals {
  grossPay: number;
  napsa: number;        // employee deduction only
  nhima: number;        // employee deduction only
  paye: number;
  schoolFees: number;
  salaryAdvance: number;
  staffLoans: number;
  otherDeductions: number;
  totalDeductions: number;  // all deductions (statutory + other)
  /** Non-statutory deductions only: school fees + advance + loans + other.
   *  This is what "Staff Deductions Control" in the journal extract should equal. */
  nonStatutoryDeductions: number;
  netPay: number;
}

// ─── Header scanning ──────────────────────────────────────────────────────────

type CellValue = string | number | boolean | null | undefined;

/** Returns the 0-based column index of the first cell (across headerRows) matching a keyword. */
function findCol(headerRows: CellValue[][], ...keywords: string[]): number {
  for (const row of headerRows) {
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] ?? "").toLowerCase().trim();
      if (keywords.some((kw) => cell === kw.toLowerCase() || cell.includes(kw.toLowerCase()))) {
        return i;
      }
    }
  }
  return -1;
}

/** Converts a cell value to a number, returning 0 for blank/null cells. */
function num(v: CellValue): number {
  if (v === null || v === undefined || v === "" || v === false) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// ─── Public entry point ───────────────────────────────────────────────────────

export function parsePayrollRegister(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: CellValue[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  if (rows.length === 0) throw new Error("Payroll Register appears to be empty");

  // ── Discover column positions from the first 5 rows ──────────────────────
  const headerRows = rows.slice(0, 5);

  const colGross      = findCol(headerRows, "Gross Pay");
  const colNapsa      = findCol(headerRows, "NAPSA");
  const colNhima      = findCol(headerRows, "NHIMA");
  const colPaye       = findCol(headerRows, "PAYE");
  const colSchoolFees = findCol(headerRows, "School fees", "School Fees");
  const colAdvance    = findCol(headerRows, "Salary Advance");
  const colLoans      = findCol(headerRows, "Staff Loans");
  const colOther      = findCol(headerRows, "Other Deductions");
  const colTotalDed   = findCol(headerRows, "Total deductions", "Total Deductions");
  const colNetPay     = findCol(headerRows, "Net Pay");

  const missing = [
    colGross < 0 && "Gross Pay",
    colNapsa < 0 && "NAPSA",
    colNhima < 0 && "NHIMA",
    colPaye  < 0 && "PAYE",
    colTotalDed < 0 && "Total Deductions",
    colNetPay < 0 && "Net Pay",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(`Payroll Register is missing expected columns: ${missing.join(", ")}`);
  }

  // ── Find the TOTAL row ────────────────────────────────────────────────────
  // It's the last row where column 1 (Name) equals "TOTAL" (case-insensitive).
  let totalsRow: CellValue[] | null = null;
  for (let i = rows.length - 1; i >= 0; i--) {
    const nameCell = String(rows[i][1] ?? "").trim().toUpperCase();
    if (nameCell === "TOTAL") {
      totalsRow = rows[i];
      break;
    }
  }
  if (!totalsRow) throw new Error("Payroll Register: TOTAL row not found");

  // ── Extract values ────────────────────────────────────────────────────────
  const grossPay        = num(totalsRow[colGross]);
  const napsa           = num(totalsRow[colNapsa]);
  const nhima           = num(totalsRow[colNhima]);
  const paye            = num(totalsRow[colPaye]);
  const schoolFees      = colSchoolFees >= 0 ? num(totalsRow[colSchoolFees]) : 0;
  const salaryAdvance   = colAdvance   >= 0 ? num(totalsRow[colAdvance])    : 0;
  const staffLoans      = colLoans     >= 0 ? num(totalsRow[colLoans])      : 0;
  const otherDeductions = colOther     >= 0 ? num(totalsRow[colOther])      : 0;
  const totalDeductions = num(totalsRow[colTotalDed]);
  const netPay          = num(totalsRow[colNetPay]);
  const nonStatutoryDeductions = schoolFees + salaryAdvance + staffLoans + otherDeductions;

  const totals: PayrollRegisterTotals = {
    grossPay,
    napsa,
    nhima,
    paye,
    schoolFees,
    salaryAdvance,
    staffLoans,
    otherDeductions,
    totalDeductions,
    nonStatutoryDeductions,
    netPay,
  };

  return {
    openingBalance: null,
    closingBalance: null,
    transactions: [],
    metadata: totals as unknown as Record<string, string | number | null>,
  };
}
