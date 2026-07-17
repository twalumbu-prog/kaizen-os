import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseSpreadsheet } from "./excel";

function buildWorkbookBuffer(headers: string[], rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

describe("parseSpreadsheet", () => {
  it("maps a ledger's Deposit/Payment columns to debit/credit per cash-book convention", () => {
    const buffer = buildWorkbookBuffer(
      ["Date", "Payee", "Payment", "Deposit", "Balance"],
      [
        ["2026-05-01", "Client A", null, 500, 1500],
        ["2026-05-02", "Landlord", 200, null, 1300],
      ],
    );

    const statement = parseSpreadsheet(buffer, "ledger");

    expect(statement.transactions).toEqual([
      { date: "2026-05-01", description: "Client A", amount: 500, type: "debit" },
      { date: "2026-05-02", description: "Landlord", amount: 200, type: "credit" },
    ]);
    expect(statement.openingBalance).toBe(1000);
    expect(statement.closingBalance).toBe(1300);
  });

  it("maps a bank statement's Debit/Credit columns directly, honoring an explicit opening/closing marker", () => {
    const buffer = buildWorkbookBuffer(
      ["Value Date", "Description", "Debit", "Credit", "Balance"],
      [
        [null, "--- Opening Balance ---", 0, 0, 1000],
        ["2026-05-01", "Client A deposit", 0, 500, 1500],
        ["2026-05-02", "Landlord payment", 200, 0, 1300],
        [null, "--- Closing Balance ---", 0, 0, 1300],
      ],
    );

    const statement = parseSpreadsheet(buffer, "bank");

    expect(statement.transactions).toEqual([
      { date: "2026-05-01", description: "Client A deposit", amount: 500, type: "credit" },
      { date: "2026-05-02", description: "Landlord payment", amount: 200, type: "debit" },
    ]);
    expect(statement.openingBalance).toBe(1000);
    expect(statement.closingBalance).toBe(1300);
  });

  it("produces matching totals for the same real-world event recorded on both sides", () => {
    // The same $500 client payment: a ledger receipt (cash-book Debit column)
    // and, on the bank's own statement, a deposit (bank's Credit column).
    const ledger = parseSpreadsheet(
      buildWorkbookBuffer(
        ["Date", "Description", "Debit", "Credit", "Balance"],
        [["2026-05-01", "Client payment", 500, null, 1500]],
      ),
      "ledger",
    );
    const bank = parseSpreadsheet(
      buildWorkbookBuffer(
        ["Date", "Description", "Debit", "Credit", "Balance"],
        [["2026-05-01", "Client payment", null, 500, 1500]],
      ),
      "bank",
    );

    expect(ledger.transactions[0].type).toBe("debit");
    expect(bank.transactions[0].type).toBe("credit");
    expect(ledger.transactions[0].amount).toBe(bank.transactions[0].amount);
  });
});
