import { describe, expect, it } from "vitest";
import { sliceStatementToPeriod } from "./periodSlice";
import type { ParsedStatement } from "../validators/types";

const ms = (d: string) => new Date(d).getTime();

describe("sliceStatementToPeriod", () => {
  it("scopes a multi-week file down to one week, deriving opening/closing from balance anchors", () => {
    const fullMonth: ParsedStatement = {
      openingBalance: 1000,
      closingBalance: 5000,
      transactions: [
        { date: "2026-07-03", description: "week 1 tx", amount: 500, type: "credit", balanceAfter: 1500 },
        { date: "2026-07-10", description: "week 2 tx", amount: 800, type: "credit", balanceAfter: 2300 },
        { date: "2026-07-15", description: "target week tx A", amount: 300, type: "credit", balanceAfter: 2600 },
        { date: "2026-07-16", description: "target week tx B", amount: 200, type: "debit", balanceAfter: 2400 },
        { date: "2026-07-24", description: "week 4 tx", amount: 2600, type: "credit", balanceAfter: 5000 },
      ],
    };

    // Target week: Fri 2026-07-10 .. Thu 2026-07-16 (Friday-anchored week containing 07-15)
    const sliced = sliceStatementToPeriod(fullMonth, ms("2026-07-10T00:00:00Z"), ms("2026-07-16T23:59:59.999Z"));

    expect(sliced.transactions.map((t) => t.description)).toEqual([
      "week 2 tx",
      "target week tx A",
      "target week tx B",
    ]);
    // Opening = balance just before periodStart (week 1's anchor).
    expect(sliced.openingBalance).toBe(1500);
    // Closing = balance at the last transaction within the window.
    expect(sliced.closingBalance).toBe(2400);
  });

  it("falls back to the file's own opening balance when nothing precedes the window", () => {
    const statement: ParsedStatement = {
      openingBalance: 1000,
      closingBalance: 1300,
      transactions: [
        { date: "2026-07-10", description: "only tx", amount: 300, type: "credit", balanceAfter: 1300 },
      ],
    };

    const sliced = sliceStatementToPeriod(statement, ms("2026-07-10T00:00:00Z"), ms("2026-07-16T23:59:59.999Z"));
    expect(sliced.openingBalance).toBe(1000);
    expect(sliced.closingBalance).toBe(1300);
  });

  it("falls back to file-wide balances when transactions have no balanceAfter anchors", () => {
    const statement: ParsedStatement = {
      openingBalance: 1000,
      closingBalance: 1300,
      transactions: [{ date: "2026-07-10", description: "no anchor", amount: 300, type: "credit" }],
    };

    const sliced = sliceStatementToPeriod(statement, ms("2026-07-10T00:00:00Z"), ms("2026-07-16T23:59:59.999Z"));
    expect(sliced.openingBalance).toBe(1000);
    expect(sliced.closingBalance).toBe(1300);
    expect(sliced.transactions).toHaveLength(1);
  });
});
