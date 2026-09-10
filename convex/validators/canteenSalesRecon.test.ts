import { describe, expect, it } from "vitest";
import { canteenSalesReconValidator } from "./canteenSalesRecon";
import type { ParsedFile, ValidationContext, ValidationRule } from "./types";

const CONTEXT: ValidationContext = {
  periodStart: Date.parse("2026-09-07T00:00:00Z"),
  periodEnd: Date.parse("2026-09-07T23:59:59Z"),
  expectedOpeningBalance: null,
};

/** Only the rules actually reachable with the real template today — the
 * other three depend on files Twalumbu isn't collecting and are disabled on
 * the live report (see convex/seedTwalumbu.ts). */
const RULES: ValidationRule[] = [
  { key: "timeliness", label: "Documents generated on the report date", enabled: true },
  { key: "cashTotalCorrect", label: "Cash total adds up", enabled: true },
  { key: "airtelTotalCorrect", label: "Airtel total adds up", enabled: true },
  { key: "grandTotalCorrect", label: "Grand total equals cash plus airtel", enabled: true },
];

function reconFile(metadata: Record<string, string | number | null>): ParsedFile {
  return {
    label: "Sales Collection Recon",
    fileType: "xlsx",
    statement: { openingBalance: null, closingBalance: null, transactions: [], metadata },
  };
}

/** Matches what convex/lib/parsers/canteenRecon.ts now actually produces for
 * the real 5-payment-method template, footer and rows in agreement. */
const CONSISTENT_METADATA = {
  date: "2026-09-07",
  preparedBy: null,
  grandTotal: null,
  amtDeposited: null,
  studentCount: 5,
  cashTotal: 70,
  cashSum: 70,
  airtelTotal: 35,
  airtelSum: 35,
  wiseTotal: 560,
  wiseSum: 560,
  bankTotal: 350,
  bankSum: 350,
  masterTotal: 140,
  masterSum: 140,
};

describe("canteenSalesReconValidator — grand total (real template, no separate Grand Total cell)", () => {
  it("passes when the footer row across all five payment methods matches the row-by-row sum", async () => {
    const result = await canteenSalesReconValidator([reconFile(CONSISTENT_METADATA)], RULES, CONTEXT);
    const check = result.checklist.find((c) => c.title === "Grand Total Is Correct");
    expect(check?.status).toBe("pass");
    expect(check?.points).toBe(10);
  });

  it("fails when a footer figure doesn't match its column's individual entries", async () => {
    const metadata = { ...CONSISTENT_METADATA, bankTotal: 300 }; // footer says 300, rows sum to 350
    const result = await canteenSalesReconValidator([reconFile(metadata)], RULES, CONTEXT);
    const check = result.checklist.find((c) => c.title === "Grand Total Is Correct");
    expect(check?.status).toBe("fail");
    expect(check?.explanation).toContain("1105.00"); // footer: 70+35+560+300+140
    expect(check?.explanation).toContain("1155.00"); // rows:   70+35+560+350+140
  });

  it("reports unreadable rather than a false failure when no Total row was found at all", async () => {
    const metadata = {
      ...CONSISTENT_METADATA,
      cashTotal: null,
      airtelTotal: null,
      wiseTotal: null,
      bankTotal: null,
      masterTotal: null,
    };
    const result = await canteenSalesReconValidator([reconFile(metadata)], RULES, CONTEXT);
    const check = result.checklist.find((c) => c.title === "Grand Total Is Correct");
    expect(check?.status).toBe("fail");
    expect(check?.explanation).toMatch(/could not find the total row/i);
  });

  it("does not double-penalise a payment method the sheet never had (null, not 0)", async () => {
    // No WISE column on the sheet at all — CONSISTENT_METADATA minus wise.
    const metadata = { ...CONSISTENT_METADATA, wiseTotal: null, wiseSum: null };
    const result = await canteenSalesReconValidator([reconFile(metadata)], RULES, CONTEXT);
    const check = result.checklist.find((c) => c.title === "Grand Total Is Correct");
    expect(check?.status).toBe("pass");
  });
});

describe("canteenSalesReconValidator — cash/airtel column checks", () => {
  it("correctly reads the real template's footer once the parser maps columns by header label", async () => {
    const result = await canteenSalesReconValidator([reconFile(CONSISTENT_METADATA)], RULES, CONTEXT);
    const cash = result.checklist.find((c) => c.title === "Cash Total Is Correct");
    const airtel = result.checklist.find((c) => c.title === "Airtel Total Is Correct");
    expect(cash?.status).toBe("pass");
    expect(airtel?.status).toBe("pass");
  });
});
