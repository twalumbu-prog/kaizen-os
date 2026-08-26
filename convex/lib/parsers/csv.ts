import Papa from "papaparse";
import type { ParsedStatement, Transaction } from "../../validators/types";

const DATE_KEYS = ["date"];
const DESCRIPTION_KEYS = ["description", "narration", "particulars", "details"];
const DEBIT_KEYS = ["debit", "dr", "withdrawal", "moneyout"];
const CREDIT_KEYS = ["credit", "cr", "deposit", "moneyin"];
const AMOUNT_KEYS = ["amount"];
const BALANCE_KEYS = ["balance", "runningbalance"];

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function pickValue(row: Record<string, string>, keys: string[]): string | undefined {
  for (const [rawKey, value] of Object.entries(row)) {
    if (keys.includes(normalizeKey(rawKey))) return value;
  }
  return undefined;
}

function toNumber(value: string | undefined): number {
  if (!value) return 0;
  const parsed = parseFloat(value.replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Parses a bank statement CSV export (Date, Description, Debit/Credit or signed Amount, Balance). */
export function parseBankCsv(text: string): ParsedStatement {
  const { data } = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const transactions: Transaction[] = [];
  const balances: number[] = [];

  let openingBalance: number | null = null;

  for (const row of data) {
    const date = pickValue(row, DATE_KEYS) ?? "";
    const description = pickValue(row, DESCRIPTION_KEYS) ?? "";
    const balanceRaw = pickValue(row, BALANCE_KEYS);
    const balance = balanceRaw !== undefined ? toNumber(balanceRaw) : undefined;
    if (balance !== undefined) balances.push(balance);

    const debit = toNumber(pickValue(row, DEBIT_KEYS));
    const credit = toNumber(pickValue(row, CREDIT_KEYS));
    const signedAmount = pickValue(row, AMOUNT_KEYS);

    // A balance-only row (no debit, no credit, no signed amount) is treated as
    // an explicit opening-balance marker — don't add it as a transaction.
    if (debit === 0 && credit === 0 && (signedAmount === undefined || toNumber(signedAmount) === 0)) {
      if (balance !== undefined && openingBalance === null) openingBalance = balance;
      continue;
    }

    let tx: (typeof transactions)[number] | null = null;
    if (debit > 0) {
      tx = { date, description, amount: debit, type: "debit" as const };
    } else if (credit > 0) {
      tx = { date, description, amount: credit, type: "credit" as const };
    } else if (signedAmount !== undefined) {
      const amount = toNumber(signedAmount);
      if (amount !== 0) {
        tx = { date, description, amount: Math.abs(amount), type: amount < 0 ? "debit" as const : "credit" as const };
      }
    }

    if (tx) {
      if (balance !== undefined) (tx as any).balanceAfter = balance;
      transactions.push(tx);
    }
  }

  return {
    openingBalance,
    closingBalance: balances.length > 0 ? balances[balances.length - 1] : null,
    transactions,
  };
}
