import { describe, expect, it } from "vitest";
import { statutoryReceiptsValidator, statutoryReceiptsMaxPoints } from "./statutoryReceipts";
import type { ParsedFile, ValidationContext, ValidationRule } from "./types";

const CONTEXT: ValidationContext = {
  periodStart: Date.parse("2026-08-01T00:00:00Z"),
  periodEnd: Date.parse("2026-08-31T23:59:59Z"),
  expectedOpeningBalance: null,
};

const RULES: ValidationRule[] = [
  { key: "payePaidOnTime", label: "", enabled: true },
  { key: "napsaPaidOnTime", label: "", enabled: true },
  { key: "nhimaPaidOnTime", label: "", enabled: true },
  { key: "payePeriodMatch", label: "", enabled: true },
  { key: "napsaPeriodMatch", label: "", enabled: true },
  { key: "nhimaPeriodMatch", label: "", enabled: true },
];

function receiptFile(label: string, metadata: Record<string, string | number | null>): ParsedFile {
  return { label, fileType: "pdf", statement: { openingBalance: null, closingBalance: null, transactions: [], metadata } };
}

describe("statutoryReceiptsValidator — score is a 0-100 percentage, not a raw point sum", () => {
  it("returns a score out of 100 even though the checklist totals 150 points", async () => {
    expect(statutoryReceiptsMaxPoints(RULES)).toBe(150);

    // Only the three period-match checks (30/150) pass; every paid-on-time
    // check fails — matches a real receipt set paid after the deadline.
    const files = [
      receiptFile("PAYE Receipt", { entityType: "ZRA_PAYE", coveragePeriod: "2026-08", paymentDate: "2026-09-08" }),
      receiptFile("NAPSA Receipt", { entityType: "NAPSA", coveragePeriod: "2026-08", paymentDate: "2026-09-07" }),
      receiptFile("NHIMA Receipt", { entityType: "NHIMA", coveragePeriod: "2026-08", paymentDate: "2026-09-10" }),
    ];

    const result = await statutoryReceiptsValidator(files, RULES, CONTEXT);

    // Before the fix this returned 30 (the raw earned-points sum) instead of
    // 20 (30/150 as a percentage) — a >100-max score silently inflating
    // finalReportScore, since every other validator returns a percentage.
    expect(result.score).toBe(20);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("returns 100 when every check passes, regardless of the 150-point max", async () => {
    const files = [
      receiptFile("PAYE Receipt", { entityType: "ZRA_PAYE", coveragePeriod: "2026-08", paymentDate: "2026-09-04" }),
      receiptFile("NAPSA Receipt", { entityType: "NAPSA", coveragePeriod: "2026-08", paymentDate: "2026-09-04" }),
      receiptFile("NHIMA Receipt", { entityType: "NHIMA", coveragePeriod: "2026-08", paymentDate: "2026-09-04" }),
    ];
    const result = await statutoryReceiptsValidator(files, RULES, CONTEXT);
    expect(result.score).toBe(100);
  });

  it("summary text still reports the true points earned out of the true max", async () => {
    const files = [
      receiptFile("PAYE Receipt", { entityType: "ZRA_PAYE", coveragePeriod: "2026-08", paymentDate: "2026-09-08" }),
    ];
    const result = await statutoryReceiptsValidator(files, RULES, CONTEXT);
    expect(result.summary).toContain("/150");
  });
});
