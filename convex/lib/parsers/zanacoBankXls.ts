import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function parseZanacoDate(raw: unknown): string {
  if (!raw) return "";
  const s = String(raw).trim();
  // "Oct 01, 2026" → "2026-10-01"
  const m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  if (m) {
    const month = MONTHS[m[1]] ?? "01";
    const day = m[2].padStart(2, "0");
    return `${m[3]}-${month}-${day}`;
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return s.slice(0, 10);
}

/**
 * Parses a Zanaco bank statement XLS export.
 * The file has a metadata block (rows 0–19) followed by a header row at row 20
 * and transaction data from row 21 onward.
 */
export function parseZanacoBankXls(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(buffer, { type: "array", cellDates: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];

  // Shift the sheet range to start at the header row (row 21 in 1-based = index 20)
  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1:A1");
  range.s.r = 20;
  sheet["!ref"] = XLSX.utils.encode_range(range);

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const transactions: ParsedStatement["transactions"] = [];
  const balances: number[] = [];

  for (const row of rows) {
    const drCr = String(row[" DR/CR"] ?? row["DR/CR"] ?? "").trim();
    if (drCr !== "C" && drCr !== "D") continue;

    const credit = Number(row["Credit"]) || 0;
    const debit = Number(row["Debit"]) || 0;
    const balance = Number(row["Balance"]);
    if (!isNaN(balance)) balances.push(balance);

    const date = parseZanacoDate(row["Txn Date"]);
    const description = String(row["Description"] ?? "").trim();

    if (credit > 0) {
      transactions.push({ date, description, amount: credit, type: "credit", balanceAfter: isNaN(balance) ? undefined : balance });
    }
    if (debit > 0) {
      transactions.push({ date, description, amount: debit, type: "debit", balanceAfter: isNaN(balance) ? undefined : balance });
    }
  }

  return {
    openingBalance: balances.length > 0 ? balances[0] - (transactions[0]?.type === "credit" ? transactions[0].amount : -(transactions[0]?.amount ?? 0)) : null,
    closingBalance: balances.length > 0 ? balances[balances.length - 1] : null,
    transactions,
  };
}
