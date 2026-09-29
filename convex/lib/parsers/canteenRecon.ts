import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

/**
 * Parses the Canteen Sales Collection Recon spreadsheet.
 *
 * Sales-tier counts added (how many students paid for each duration):
 *   salesCountDaily, salesCount2Day, salesCount3Day, salesCountWeekly,
 *   salesCount2Week, salesCount3Week, salesCountMonthly, salesCountOther
 */

const PAYMENT_METHODS = ["cash", "airtel", "wise", "bank", "master"] as const;
type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const RATE_PER_DAY = 35;

const SALES_TIERS: Array<{ days: number; key: string }> = [
  { days: 1,  key: "salesCountDaily"   },
  { days: 2,  key: "salesCount2Day"    },
  { days: 3,  key: "salesCount3Day"    },
  { days: 4,  key: "salesCountWeekly"  },
  { days: 8,  key: "salesCount2Week"   },
  { days: 12, key: "salesCount3Week"   },
  { days: 16, key: "salesCountMonthly" },
];

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

function toAmt(val: unknown): number {
  if (val === null || val === undefined || val === "-" || val === "") return 0;
  if (typeof val === "number") return val;
  const n = parseFloat(String(val).replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

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

function parseDateToken(text: string): string | null {
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
  const tierCounts = new Map<string, number>();
  let salesCountOther = 0;
  let headerSeen = false;

  for (const row of rows) {
    const a = String(row[0] ?? "").trim();
    const b = row[1];

    if (!headerSeen && date === null) {
      for (const cell of row) {
        const found =
          cell instanceof Date ? toDateStr(cell)
          : typeof cell === "string" ? parseDateToken(cell)
          : null;
        if (found) { date = found; break; }
      }
    }

    if (/^date[:\s]/i.test(a)) {
      date = toDateStr(b) ?? date;
      const d = String(row[3] ?? "").trim();
      if (/^prepared by/i.test(d)) preparedBy = String(row[4] ?? "").trim() || null;
      continue;
    }

    if (/grand total/i.test(a)) { grandTotal = toAmt(b); continue; }
    if (/amt deposited/i.test(a)) {
      amtDeposited = b !== null && b !== undefined ? toAmt(b) : null;
      continue;
    }

    if (!headerSeen && row.some((cell) => typeof cell === "string" && methodForLabel(cell))) {
      row.forEach((cell, idx) => {
        if (typeof cell !== "string") return;
        const method = methodForLabel(cell);
        if (method) methodColumn.set(method, idx);
      });
      headerSeen = true;
      continue;
    }

    const isTotal = row.slice(0, 4).some((cell) => typeof cell === "string" && isTotalLabel(cell));
    if (isTotal) {
      for (const [method, idx] of methodColumn) totals.set(method, toAmt(row[idx]));
      continue;
    }

    const cleanedA = a.replace(/[^0-9.]/g, "");
    const rowNo = typeof row[0] === "number" ? row[0] : (cleanedA ? parseFloat(cleanedA) : NaN);
    const hasValidRowNo = Number.isFinite(rowNo) && rowNo > 0;
    const colB = String(row[1] ?? "").trim();
    const colC = String(row[2] ?? "").trim();
    const isHeaderOrMetaKey =
      /^(no|s\/n|serial|name|class|total|grand total|amt deposited|date|prepared by)$/i.test(a) ||
      /^(no|s\/n|serial|name|class|total)$/i.test(colB);
    const hasPaymentValue = Array.from(methodColumn.values()).some((idx) => toAmt(row[idx]) > 0);
    const hasStudentName =
      (colB.length >= 2 || colC.length >= 2 || (a.length >= 2 && !hasValidRowNo)) &&
      !isHeaderOrMetaKey;

    if (headerSeen && (hasValidRowNo || (hasStudentName && hasPaymentValue))) {
      studentCount++;

      let rowTotal = 0;
      for (const [method, idx] of methodColumn) {
        const amt = toAmt(row[idx]);
        sums.set(method, (sums.get(method) ?? 0) + amt);
        rowTotal += amt;
      }

      if (rowTotal > 0) {
        const days = Math.round(rowTotal / RATE_PER_DAY);
        const tier = SALES_TIERS.find((t) => t.days === days);
        if (tier) {
          tierCounts.set(tier.key, (tierCounts.get(tier.key) ?? 0) + 1);
        } else {
          salesCountOther++;
        }
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

  for (const tier of SALES_TIERS) {
    metadata[tier.key] = tierCounts.get(tier.key) ?? 0;
  }
  if (salesCountOther > 0) {
    metadata.salesCountOther = salesCountOther;
  }

  return { openingBalance: null, closingBalance: null, transactions: [], metadata };
}
