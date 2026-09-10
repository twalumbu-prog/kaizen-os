import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

/**
 * Parses the Canteen Sales Collection Recon spreadsheet.
 *
 * The real template canteen staff fill in is a plain payments table, not a
 * form with labeled header fields:
 *
 *   Row 1                 → a title like "LUNCH - 07.09.2026" (the date is
 *                            read from wherever a d.m.yyyy-style token
 *                            appears in the first few rows)
 *   Header row             → NO. | NAME | CLASS | <payment method columns…>
 *   Student rows            → col A is the row number (1, 2, 3 …)
 *   Footer row              → "TOTAL" in col A or col B, with each payment
 *                            method's column total below its header
 *
 * Payment-method columns are read by matching the header row's own labels
 * (CASH, AIRTEL, WISE, BANK, MASTER/MASTERFEES) rather than fixed column
 * positions, since which methods appear — and in what order — can change
 * sheet to sheet.
 *
 * A "Date:" / "Prepared by:" labeled row and a "Grand Total" / "AMT
 * Deposited" row are also recognised if present, for older-style sheets.
 *
 * Metadata keys produced (consumed by canteenSalesRecon validator):
 *   date, preparedBy, grandTotal, amtDeposited, studentCount,
 *   <method>Total for each recognised column (e.g. cashTotal, wiseTotal) — the
 *     figure on the footer row, or null if that column isn't on the sheet,
 *   <method>Sum for each recognised column — re-summed from the student rows.
 */

const PAYMENT_METHODS = ["cash", "airtel", "wise", "bank", "master"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Header label → the metadata key it maps to. "master"/"masterfees" are the same column. */
function methodForLabel(label: string): PaymentMethod | null {
  const norm = label.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (norm === "cash") return "cash";
  if (norm === "airtel") return "airtel";
  if (norm === "wise") return "wise";
  if (norm === "bank") return "bank";
  if (norm === "master" || norm === "masterfees") return "master";
  return null;
}

function metaKey(method: PaymentMethod, suffix: "Total" | "Sum"): string {
  return `${method}${suffix}`;
}

// "-" or blank cells represent zero in a payment-method column.
function toAmt(val: unknown): number {
  if (val === null || val === undefined || val === "-" || val === "") return 0;
  if (typeof val === "number") return val;
  const n = parseFloat(String(val).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Used for an explicit "Date:" field, which may be typed in almost any format. */
function toDateStr(val: unknown): string | null {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (!val) return null;
  const raw = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const token = parseDateToken(raw);
  if (token) return token;
  const parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/**
 * Finds a d.m.yyyy / d-m-yyyy / d/m/yyyy token anywhere in a string — the
 * title row reads e.g. "LUNCH - 07.09.2026" rather than a labeled date field.
 */
function parseDateToken(text: string): string | null {
  // Word-boundary anchored so this can't match a stray substring of an
  // already-ISO "yyyy-mm-dd" value (e.g. reading "26-09-07" out of
  // "2026-09-07") — there is no boundary between two adjacent digits.
  const match = text.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/);
  if (!match) return null;
  const [, a, b, y] = match;
  const year = y.length === 2 ? `20${y}` : y;
  const day = a.padStart(2, "0");
  const month = b.padStart(2, "0");
  if (Number(month) <= 12 && Number(day) <= 31) return `${year}-${month}-${day}`;
  return null;
}

function isTotalLabel(text: string): boolean {
  return /^total$/i.test(text.trim());
}

export function parseCanteenRecon(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  let date: string | null = null;
  let preparedBy: string | null = null;
  let grandTotal: number | null = null;
  let amtDeposited: number | null = null;
  let studentCount = 0;

  const methodColumn = new Map<PaymentMethod, number>();
  const totals = new Map<PaymentMethod, number>();
  const sums = new Map<PaymentMethod, number>();
  let headerSeen = false;

  for (const row of rows) {
    const a = String(row[0] ?? "").trim();
    const b = row[1];

    // A title row (before the header) may carry the date, e.g. "LUNCH - 07.09.2026".
    if (!headerSeen && date === null) {
      for (const cell of row) {
        if (typeof cell === "string") {
          const found = parseDateToken(cell);
          if (found) {
            date = found;
            break;
          }
        }
      }
    }

    // Older-style sheets: an explicit "Date:" labeled row.
    if (/^date[:\s]/i.test(a)) {
      date = toDateStr(b) ?? date;
      const d = String(row[3] ?? "").trim();
      if (/^prepared by/i.test(d)) preparedBy = String(row[4] ?? "").trim() || null;
      continue;
    }

    if (/grand total/i.test(a)) {
      grandTotal = toAmt(b);
      continue;
    }

    if (/amt deposited/i.test(a)) {
      amtDeposited = b !== null && b !== undefined ? toAmt(b) : null;
      continue;
    }

    // Header row: whichever columns carry a recognised payment-method label.
    if (!headerSeen && row.some((cell) => typeof cell === "string" && methodForLabel(cell))) {
      row.forEach((cell, idx) => {
        if (typeof cell !== "string") return;
        const method = methodForLabel(cell);
        if (method) methodColumn.set(method, idx);
      });
      headerSeen = true;
      continue;
    }

    // Footer row: "TOTAL" in col A or col B, with each method's total in its own column.
    if (isTotalLabel(a) || (typeof b === "string" && isTotalLabel(b))) {
      for (const [method, idx] of methodColumn) {
        totals.set(method, toAmt(row[idx]));
      }
      continue;
    }

    // Student row: col A is the row's serial number.
    const rowNo = typeof row[0] === "number" ? row[0] : parseFloat(a);
    if (Number.isFinite(rowNo) && rowNo > 0) {
      studentCount++;
      for (const [method, idx] of methodColumn) {
        sums.set(method, (sums.get(method) ?? 0) + toAmt(row[idx]));
      }
    }
  }

  const metadata: Record<string, string | number | null> = {
    date,
    preparedBy,
    grandTotal,
    amtDeposited,
    studentCount,
  };
  for (const method of PAYMENT_METHODS) {
    metadata[metaKey(method, "Total")] = totals.get(method) ?? null;
    metadata[metaKey(method, "Sum")] = methodColumn.has(method) ? (sums.get(method) ?? 0) : null;
  }

  return { openingBalance: null, closingBalance: null, transactions: [], metadata };
}
