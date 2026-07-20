import * as XLSX from "xlsx";
import type { ParsedStatement, Transaction } from "../../validators/types";

const DATE_KEYS = ["date", "valuedate", "transactiondate", "txndate", "trandate"];
const DESCRIPTION_KEYS = ["description", "narration", "particulars", "details", "payee"];
const BALANCE_KEYS = ["balance", "runningbalance"];
const OPENING_MARKER = /opening\s*balance/i;
const CLOSING_MARKER = /closing\s*balance/i;

/**
 * A spreadsheet's "money in" / "money out" columns are only unambiguous once
 * you know whether it's a bank statement or a cash-book style ledger. Bank
 * statements label columns from the bank's own point of view (Debit =
 * withdrawal, Credit = deposit). Ledgers follow cash-book convention, where
 * receipts (deposits) are recorded on the Debit side and payments on the
 * Credit side — the opposite of the bank's own labels for the same column
 * names like "Deposit"/"Payment".
 */
export type SpreadsheetRole = "ledger" | "bank";

const MONEY_IN_KEYS: Record<SpreadsheetRole, string[]> = {
  bank: ["credit", "cr", "deposit", "moneyin", "receipt"],
  ledger: ["debit", "dr", "deposit", "receipt", "moneyin"],
};
const MONEY_OUT_KEYS: Record<SpreadsheetRole, string[]> = {
  bank: ["debit", "dr", "withdrawal", "payment", "moneyout"],
  ledger: ["credit", "cr", "payment", "withdrawal", "moneyout"],
};

// The validator compares ledger and bank totals under the double-entry
// convention: the same real-world deposit is a ledger "debit" (cash-book
// receipt) but a bank "credit" (the bank's own liability increases) — same
// event, opposite perspective labels. So which Transaction.type a "money in"
// row gets depends on the file's role, not just its direction.
const IN_TYPE: Record<SpreadsheetRole, Transaction["type"]> = { ledger: "debit", bank: "credit" };
const OUT_TYPE: Record<SpreadsheetRole, Transaction["type"]> = { ledger: "credit", bank: "debit" };

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function pickValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const [rawKey, value] of Object.entries(row)) {
    if (keys.includes(normalizeKey(rawKey))) return value;
  }
  return undefined;
}

// Matches d/m/yyyy or d-m-yyyy (also dd/mm/yy) — the common non-ISO export format.
const SLASH_DATE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/;

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    // Excel serial date.
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + value);
    return epoch.toISOString().slice(0, 10);
  }

  const raw = String(value ?? "").trim();

  // JS's `new Date(string)` assumes US MM/DD/YYYY for slash-separated dates,
  // silently misparsing (or failing on) the DD/MM/YYYY exports common
  // outside the US — parse those explicitly as day/month/year first.
  const slashMatch = raw.match(SLASH_DATE);
  if (slashMatch) {
    const [, d, m, y] = slashMatch;
    const year = y.length === 2 ? `20${y}` : y;
    const day = d.padStart(2, "0");
    const month = m.padStart(2, "0");
    if (Number(month) <= 12 && Number(day) <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return raw.slice(0, 10);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(String(value ?? "").replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parses a ledger or bank statement spreadsheet into a normalized statement. */
export function parseSpreadsheet(buffer: ArrayBuffer, role: SpreadsheetRole): ParsedStatement {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const moneyInKeys = MONEY_IN_KEYS[role];
  const moneyOutKeys = MONEY_OUT_KEYS[role];

  const transactions: Transaction[] = [];
  const balances: number[] = [];
  let openingOverride: number | null = null;
  let closingOverride: number | null = null;

  for (const row of rows) {
    const moneyIn = toNumber(pickValue(row, moneyInKeys));
    const moneyOut = toNumber(pickValue(row, moneyOutKeys));
    const balanceValue = pickValue(row, BALANCE_KEYS);
    const description = String(pickValue(row, DESCRIPTION_KEYS) ?? "");

    if (moneyIn === 0 && moneyOut === 0 && OPENING_MARKER.test(description)) {
      if (balanceValue !== undefined && balanceValue !== null) openingOverride = toNumber(balanceValue);
      continue;
    }
    if (moneyIn === 0 && moneyOut === 0 && CLOSING_MARKER.test(description)) {
      if (balanceValue !== undefined && balanceValue !== null) closingOverride = toNumber(balanceValue);
      continue;
    }

    const rowBalance = balanceValue !== undefined && balanceValue !== null ? toNumber(balanceValue) : undefined;
    if (rowBalance !== undefined) {
      balances.push(rowBalance);
    }

    const date = toDateString(pickValue(row, DATE_KEYS));

    if (moneyIn > 0) {
      transactions.push({ date, description, amount: moneyIn, type: IN_TYPE[role], balanceAfter: rowBalance });
    }
    if (moneyOut > 0) {
      transactions.push({ date, description, amount: moneyOut, type: OUT_TYPE[role], balanceAfter: rowBalance });
    }
  }

  // The first row's running balance is *after* that row's transaction; back
  // it out so openingBalance reflects the balance before any transactions —
  // unless an explicit opening-balance marker row already gave us the value.
  const first = transactions[0];
  const firstWasInflow = first !== undefined && first.type === IN_TYPE[role];
  const openingBalance =
    openingOverride ??
    (balances.length > 0
      ? balances[0] - (first ? (firstWasInflow ? first.amount : -first.amount) : 0)
      : null);

  return {
    openingBalance,
    closingBalance: closingOverride ?? (balances.length > 0 ? balances[balances.length - 1] : null),
    transactions,
  };
}
