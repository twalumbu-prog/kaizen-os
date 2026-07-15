import type { ParsedStatement, Transaction } from "../../validators/types";

// Matches lines like: "01/02/2024  ATM Withdrawal  -120.00  4380.00"
// date, description, amount (optionally signed), running balance.
const LINE_PATTERN =
  /^(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s*$/;

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, ""));
}

function normalizeDate(raw: string): string {
  const parts = raw.split(/[/\-]/);
  if (parts.length !== 3) return raw;
  let [a, b, c] = parts;
  if (c.length === 2) c = `20${c}`;
  // Assume day/month/year for ambiguous two-digit-leading dates.
  return `${c}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
}

/** Best-effort extraction of a transaction table from a bank statement PDF's text layer. */
export async function parseBankPdf(buffer: ArrayBuffer): Promise<ParsedStatement> {
  // Dynamically imported so this Node-only dependency (pdfjs-dist) is only
  // ever loaded inside the Convex action's Node runtime, not statically
  // bundled for the V8 isolate runtime used by queries/mutations.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const { text } = await parser.getText();
  await parser.destroy();
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  const transactions: Transaction[] = [];
  let previousBalance: number | null = null;
  let openingBalance: number | null = null;
  let closingBalance: number | null = null;

  for (const line of lines) {
    const match = line.match(LINE_PATTERN);
    if (!match) continue;
    const [, dateRaw, description, amountRaw, balanceRaw] = match;
    const amount = toNumber(amountRaw);
    const balance = toNumber(balanceRaw);

    if (openingBalance === null) {
      openingBalance = previousBalance ?? balance - amount;
    }

    const type: Transaction["type"] =
      amount < 0 ? "debit" : previousBalance !== null && balance < previousBalance ? "debit" : "credit";

    transactions.push({
      date: normalizeDate(dateRaw),
      description: description.trim(),
      amount: Math.abs(amount),
      type,
    });

    previousBalance = balance;
    closingBalance = balance;
  }

  return { openingBalance, closingBalance, transactions };
}
