import { describe, expect, it } from "vitest";
import { monthNameToNumber, parseNapsa, parseNhima, parseZraPaye } from "./receipt";

// pdf-parse decodes real PDF bytes, so these fixtures are plain text
// reproducing exactly what it returns for each portal's real export — not
// the assumed layout the parser was originally written against. Anonymised
// (no real employer numbers or names).

/**
 * The real ZRA "Payment Receipt" export: pdf-parse returns every label
 * grouped together, then every value grouped together in the same order —
 * label and value are never adjacent in the extracted text.
 */
const ZRA_REAL_SHAPE = [
  "1234567890",
  "0966000000",
  "SCHOOL@EXAMPLE.COM",
  "Processed Date:",
  "Payment Date:",
  "PRN:",
  "Receipt No.",
  "2026-09-08 08:01:54.027",
  "2026-09-08 00:00:00.0",
  "212610724250",
  "212610724250",
  "Email:",
  "Contact No:",
  "Tax Type Liability Type Account Name Reference Period Start Period End Amount (ZMW)",
  "Pay As You Earn PAY (Pay As You Earn) -",
  "- 01/08/2026 31/08/2026 2,827.00",
  "Total 2,827.00",
].join("\n");

/** The real NAPSA "Contribution/Penalty Receipt" export. */
const NAPSA_REAL_SHAPE = [
  "NATIONAL PENSION SCHEME AUTHORITY",
  "Contribution/Penalty Receipt",
  "Receipt Number: 203436800",
  "Receipted Date: 07 SEPT 2026 Date printed: 07/09/2026 : 12:45",
  "Period(Month/Year) Reference Number Contribution",
  "8/2026 126136020260804081026 9,629.5 0 9,629.5",
].join("\n");

describe("parseZraPaye — real Payment Receipt layout", () => {
  it("recovers Payment Date via the zeroed-time fallback when it isn't adjacent to its label", () => {
    const receipt = parseZraPaye(ZRA_REAL_SHAPE);
    expect(receipt.paymentDate).toBe("2026-09-08");
  });

  it("doesn't confuse Payment Date with Processed Date (which has a real, non-midnight time)", () => {
    const receipt = parseZraPaye(ZRA_REAL_SHAPE);
    expect(receipt.paymentDate).not.toContain("08:01:54");
  });

  it("still reads the coverage period and amount from the table row, which stays adjacent", () => {
    const receipt = parseZraPaye(ZRA_REAL_SHAPE);
    expect(receipt.coveragePeriod).toBe("2026-08");
    expect(receipt.amount).toBe(2827);
  });

  it("prefers the adjacent-label pattern when the PDF layout does keep them together", () => {
    const receipt = parseZraPaye("Payment Date: 2026-05-15 00:00:00.0\n01/04/2026 30/04/2026 100.00");
    expect(receipt.paymentDate).toBe("2026-05-15");
  });
});

describe("parseNapsa — real Contribution/Penalty Receipt layout", () => {
  it("reads 'Receipted Date' in day/MONTHNAME/year format, not the ISO 'Receipt Date' style", () => {
    const receipt = parseNapsa(NAPSA_REAL_SHAPE);
    expect(receipt.paymentDate).toBe("2026-09-07");
  });

  it("reads the period row as month/year, not year/month", () => {
    const receipt = parseNapsa(NAPSA_REAL_SHAPE);
    expect(receipt.coveragePeriod).toBe("2026-08");
    expect(receipt.amount).toBe(9629.5);
  });

  it("doesn't mistake the unrelated 'Date printed: 07/09/2026' for the period row", () => {
    // Without an anchor on the long reference number that follows the real
    // period row, "09/2026" inside that date would match first and silently
    // produce September instead of the true August period.
    const receipt = parseNapsa(NAPSA_REAL_SHAPE);
    expect(receipt.coveragePeriod).not.toBe("2026-09");
  });

  it("still supports the ISO-formatted 'Receipt Date: yyyy-mm-dd' style", () => {
    const receipt = parseNapsa("Receipt Date: 2026-03-12\n5/2026 998877665544 100.0 0 100.0");
    expect(receipt.paymentDate).toBe("2026-03-12");
  });
});

describe("monthNameToNumber", () => {
  it("handles NAPSA's non-standard 4-letter 'SEPT' abbreviation", () => {
    expect(monthNameToNumber("SEPT")).toBe("09");
  });

  it("handles the standard 3-letter abbreviation and full names too", () => {
    expect(monthNameToNumber("Sep")).toBe("09");
    expect(monthNameToNumber("September")).toBe("09");
    expect(monthNameToNumber("January")).toBe("01");
  });

  it("returns null for an unrecognised month", () => {
    expect(monthNameToNumber("Foo")).toBeNull();
  });
});

describe("parseNhima — unaffected by this fix, pinned so it stays that way", () => {
  it("reads the tab-separated real eNHIMA export", () => {
    const text = [
      "National Health Insurance Management Authority",
      "Proof of Payment",
      "Period \tContribution Amount (ZMW) \tPenalty Amount (ZMW) \tTotal Amount (ZMW)",
      "2026 - 8 \t1460.78 \t0.00 \t1460.78",
      "Employer Number:07044004 \tDate Generated:2026-09-10",
      "Employer Name:EXAMPLE SCHOOL \tPayment reference:54520026091011",
    ].join("\n");
    const receipt = parseNhima(text);
    expect(receipt.paymentDate).toBe("2026-09-10");
    expect(receipt.coveragePeriod).toBe("2026-08");
    expect(receipt.receiptNumber).toBe("54520026091011");
  });
});
