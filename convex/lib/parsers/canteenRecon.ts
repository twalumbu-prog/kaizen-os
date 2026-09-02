import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

/**
 * Parses the Canteen Sales Collection Recon spreadsheet.
 *
 * Expected layout (rows searched by label, not hard-coded indices):
 *   Row with "Date:" in col A         → date in col B; "Prepared by:" in col D → name in col E
 *   Row with "Grand Total"            → total in col B
 *   Row with "AMT Deposited"          → amount deposited in col B
 *   Header row: NO. | NAME | CLASS | CASH | AIRTEL | MASTERFEES
 *   Student rows: col A is a number (1, 2, 3 …)
 *   Total/footer row: "Total" in col A
 *
 * Metadata keys produced (consumed by canteenSalesRecon validator):
 *   date, preparedBy, grandTotal, amtDeposited,
 *   cashTotal, airtelTotal, masterfeesTotal  (from the footer row)
 *   cashSum, airtelSum, masterfeesSum        (re-summed from individual rows)
 *   studentCount
 */
export function parseCanteenRecon(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // "-" or blank cells represent zero in the CASH/AIRTEL columns.
  const toAmt = (val: unknown): number => {
    if (val === null || val === undefined || val === "-" || val === "") return 0;
    if (typeof val === "number") return val;
    const n = parseFloat(String(val).replace(/[,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  const toDateStr = (val: unknown): string | null => {
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (!val) return null;
    const raw = String(val).trim();
    // d/m/yyyy or m/d/yyyy — try both interpretations and prefer the one where
    // month ≤ 12 and day ≤ 31; if ambiguous we use d/m (local convention).
    const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slash) {
      const [, a, b, y] = slash;
      const year = y.length === 2 ? `20${y}` : y;
      const day = a.padStart(2, "0");
      const month = b.padStart(2, "0");
      if (Number(month) <= 12 && Number(day) <= 31)
        return `${year}-${month}-${day}`;
    }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  };

  let date: string | null = null;
  let preparedBy: string | null = null;
  let grandTotal: number | null = null;
  let amtDeposited: number | null = null;
  let cashTotal: number | null = null;
  let airtelTotal: number | null = null;
  let masterfeesTotal: number | null = null;
  let studentCount = 0;
  let cashSum = 0;
  let airtelSum = 0;
  let masterfeesSum = 0;

  for (const row of rows) {
    const a = String(row[0] ?? "").trim();
    const b = row[1];
    const d = String(row[3] ?? "").trim();

    if (/^date[:\s]/i.test(a)) {
      date = toDateStr(b);
      if (/^prepared by/i.test(d)) {
        preparedBy = String(row[4] ?? "").trim() || null;
      }
      continue;
    }

    if (/grand total/i.test(a)) {
      grandTotal = typeof b === "number" ? b : toAmt(b);
      continue;
    }

    if (/amt deposited/i.test(a)) {
      amtDeposited = b !== null && b !== undefined ? toAmt(b) : null;
      continue;
    }

    if (/^total$/i.test(a)) {
      cashTotal = toAmt(row[3]);
      airtelTotal = toAmt(row[4]);
      masterfeesTotal = toAmt(row[5]);
      continue;
    }

    // Student row: col A is a positive integer (the row number).
    const rowNo = typeof row[0] === "number" ? row[0] : parseFloat(String(row[0] ?? ""));
    if (Number.isFinite(rowNo) && rowNo > 0 && !isNaN(rowNo)) {
      studentCount++;
      cashSum += toAmt(row[3]);
      airtelSum += toAmt(row[4]);
      masterfeesSum += toAmt(row[5]);
    }
  }

  return {
    openingBalance: null,
    closingBalance: null,
    transactions: [],
    metadata: {
      date,
      preparedBy,
      grandTotal,
      amtDeposited,
      cashTotal,
      airtelTotal,
      masterfeesTotal,
      studentCount,
      cashSum,
      airtelSum,
      masterfeesSum,
    },
  };
}
