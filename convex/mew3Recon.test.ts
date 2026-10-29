import { describe, expect, it } from "vitest";
import { buildWorkbook } from "./mew3Recon";
import { buildMasterRegister, reconcileDay } from "./lib/mew3/recon";
import { normalizeMwTxn } from "./lib/mew3/moneywise";
import { parseUploadedFile } from "./lib/parsers";
import { mew3DailyReconValidator } from "./validators/mew3DailyRecon";

const D = "2026-10-28";

describe("MEW3 reconciliation workbook", () => {
  it("round-trips its checks through the parser and validator", async () => {
    const guests = [
      { guestName: "Mary Banda", room: "3", checkIn: D, checkOut: "2026-10-30", nights: 2, guests: 2, phone: null, receiptNumber: "11", amount: null, paymentMethod: null },
      { guestName: "Peter Mwale", room: "5", checkIn: D, checkOut: null, nights: 1, guests: 1, phone: null, receiptNumber: null, amount: null, paymentMethod: null },
    ];
    const receipts = [
      { receiptNumber: "11", date: D, guestName: "Mary Banda", room: "3", checkIn: D, checkOut: null, nights: 2, amount: 1200, paymentMethod: "cash" as const, methodWritten: "Cash" },
    ];
    const txns = [
      normalizeMwTxn({ id: "t1", amount: "1200.00", type: "credit", category: { name: "Accommodation Revenue" }, created_at: `${D}T15:00:00Z`, description: "Rcpt 11" }, 0)!,
    ];
    const result = reconcileDay({
      date: D,
      guests,
      receipts,
      deposits: [{ date: D, amount: 1200, source: "cash", destination: "MoneyWise", reference: "DS1" }],
      moneywise: { ok: true, txns },
      earlierGuests: [],
      earlierReceipts: [],
    });
    const master = buildMasterRegister(D, guests.map((g) => ({ ...g, registerDate: D })), receipts.map((r) => ({ ...r, reportDate: D })));

    const buffer = buildWorkbook(result, master, "test");
    const statement = await parseUploadedFile("xlsx", buffer, "bank", "mew3DailyRecon", "Reconciliation Workbook");
    expect(statement.metadata?.unreceiptedGuests).toBe(1);
    expect(statement.metadata?.inHouseUnpaid).toBe(1);

    const v = await mew3DailyReconValidator([{ label: "Reconciliation Workbook", fileType: "xlsx", statement }]);
    expect(v.score).toBe(result.score);
    expect(v.checklist.find((c) => c.title === "Every check-in has a receipt")?.status).toBe("fail");
    expect(v.checklist.find((c) => c.title === "Receipts recorded as revenue in MoneyWise")?.status).toBe("pass");
  });

  it("reads MoneyWise timestamps on Lusaka time", () => {
    expect(normalizeMwTxn({ amount: 50, created_at: "2026-10-28T23:30:00Z" }, 0)?.date).toBe("2026-10-29");
    expect(normalizeMwTxn({ amount: -50, created_at: "2026-10-28T10:00:00Z" }, 0)?.direction).toBe("out");
  });
});
