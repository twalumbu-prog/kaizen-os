import { describe, expect, it } from "vitest";
import { normalizeMwTxn } from "./moneywise";

const row = (over: Record<string, unknown>) => ({
  id: "e1", date: "2026-11-08", description: "Sale: Room 3", debit: 0, credit: 0, balance_after: 0,
  type: "INFLOW", status: "COMPLETED", ledger: "CASH", account: { id: "a", code: "4000", name: "Accommodation" },
  reference: "REC-0001", external_reference: null, payer_name: "John Phiri", payment_channel: null, created_at: "2026-11-08T10:00:00Z",
  ...over,
});

describe("normalizeMwTxn on MoneyWise cashbook entries", () => {
  it("reads a cash sale as revenue coming in", () => {
    const t = normalizeMwTxn(row({ debit: 950 }), 0)!;
    expect(t).toMatchObject({ amount: 950, direction: "in", isRevenue: true, wallet: "Cash", category: "Accommodation", reference: "REC-0001", date: "2026-11-08" });
    expect(t.description).toContain("John Phiri");
  });

  it("names the Airtel Money ledger", () => {
    expect(normalizeMwTxn(row({ debit: 400, ledger: "AIRTEL_MONEY" }), 0)!.wallet).toBe("Airtel Money");
  });

  it("treats a credit as money going out", () => {
    expect(normalizeMwTxn(row({ credit: 511, type: "DISBURSEMENT", description: "Requisition" }), 0)).toMatchObject({ direction: "out", isRevenue: false });
  });

  it("does not count a transfer between ledgers as takings", () => {
    expect(normalizeMwTxn(row({ debit: 950, type: "ADJUSTMENT", description: "Transfer from Cash" }), 0)).toMatchObject({ direction: "transfer", isRevenue: false });
  });

  it("skips zero rows", () => {
    expect(normalizeMwTxn(row({}), 0)).toBeNull();
  });
});
