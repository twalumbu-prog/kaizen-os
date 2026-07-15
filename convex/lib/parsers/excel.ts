import * as XLSX from "xlsx";
import type { ParsedStatement, Transaction } from "../../validators/types";

const DATE_KEYS = ["date"];
const DESCRIPTION_KEYS = ["description", "narration", "particulars", "details"];
const DEBIT_KEYS = ["debit", "dr", "withdrawal"];
const CREDIT_KEYS = ["credit", "cr", "deposit"];
const BALANCE_KEYS = ["balance", "runningbalance"];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function pickValue(row: Record<string, unknown>, keys: string[]): unknown {
  for (const [rawKey, value] of Object.entries(row)) {
    if (keys.includes(normalizeKey(rawKey))) return value;
  }
  return undefined;
}

function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    // Excel serial date.
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + value);
    return epoch.toISOString().slice(0, 10);
  }
  return String(value ?? "").slice(0, 10);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const parsed = parseFloat(String(value ?? "").replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parses a ledger spreadsheet (Date, Description, Debit, Credit, Balance columns). */
export function parseLedgerExcel(buffer: ArrayBuffer): ParsedStatement {
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
  });

  const transactions: Transaction[] = [];
  const balances: number[] = [];

  for (const row of rows) {
    const debit = toNumber(pickValue(row, DEBIT_KEYS));
    const credit = toNumber(pickValue(row, CREDIT_KEYS));
    const balanceValue = pickValue(row, BALANCE_KEYS);
    if (balanceValue !== undefined && balanceValue !== null) {
      balances.push(toNumber(balanceValue));
    }

    const date = toDateString(pickValue(row, DATE_KEYS));
    const description = String(pickValue(row, DESCRIPTION_KEYS) ?? "");

    if (debit > 0) {
      transactions.push({ date, description, amount: debit, type: "debit" });
    }
    if (credit > 0) {
      transactions.push({ date, description, amount: credit, type: "credit" });
    }
  }

  // The first row's running balance is *after* that row's transaction; back
  // it out so openingBalance reflects the balance before any transactions.
  const first = transactions[0];
  const openingBalance =
    balances.length > 0
      ? balances[0] - (first ? (first.type === "debit" ? -first.amount : first.amount) : 0)
      : null;

  return {
    openingBalance,
    closingBalance: balances.length > 0 ? balances[balances.length - 1] : null,
    transactions,
  };
}
