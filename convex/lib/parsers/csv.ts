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

  for (const row of data) {
    const date = pickValue(row, DATE_KEYS) ?? "";
    const description = pickValue(row, DESCRIPTION_KEYS) ?? "";
    const balanceValue = pickValue(row, BALANCE_KEYS);
    if (balanceValue !== undefined) balances.push(toNumber(balanceValue));

    const debit = toNumber(pickValue(row, DEBIT_KEYS));
    const credit = toNumber(pickValue(row, CREDIT_KEYS));
    const signedAmount = pickValue(row, AMOUNT_KEYS);

    if (debit > 0) {
      transactions.push({ date, description, amount: debit, type: "debit" });
    } else if (credit > 0) {
      transactions.push({ date, description, amount: credit, type: "credit" });
    } else if (signedAmount !== undefined) {
      const amount = toNumber(signedAmount);
      if (amount !== 0) {
        transactions.push({
          date,
          description,
          amount: Math.abs(amount),
          type: amount < 0 ? "debit" : "credit",
        });
      }
    }
  }

  return {
    openingBalance: null,
    closingBalance: balances.length > 0 ? balances[balances.length - 1] : null,
    transactions,
  };
}
