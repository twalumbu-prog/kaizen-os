import { describe, expect, it } from "vitest";
import {
  buildMasterRegister,
  matchGuestsToReceipts,
  normalizeDate,
  normalizeMethod,
  normalizeReceiptNo,
  reconcileDay,
  type DayInput,
} from "./recon";
import type { Deposit, GuestStay, MwTxn, Receipt } from "./types";

const D = "2026-10-28";

const guest = (over: Partial<GuestStay>): GuestStay => ({
  guestName: "",
  room: null,
  checkIn: D,
  checkOut: null,
  nights: null,
  guests: 1,
  phone: null,
  receiptNumber: null,
  amount: null,
  paymentMethod: null,
  ...over,
});

const receipt = (over: Partial<Receipt>): Receipt => ({
  receiptNumber: null,
  date: D,
  guestName: "",
  room: null,
  checkIn: D,
  checkOut: null,
  nights: null,
  amount: 0,
  paymentMethod: "cash",
  methodWritten: null,
  ...over,
});

const mw = (over: Partial<MwTxn>): MwTxn => ({
  id: Math.random().toString(36).slice(2),
  date: D,
  amount: 0,
  direction: "in",
  description: "",
  reference: null,
  category: "Revenue",
  wallet: "Main",
  isRevenue: true,
  ...over,
});

const deposit = (over: Partial<Deposit>): Deposit => ({ date: D, amount: 0, source: "cash", destination: "MoneyWise", reference: null, ...over });

function day(over: Partial<DayInput>): DayInput {
  return { date: D, guests: [], receipts: [], deposits: [], moneywise: { ok: true, txns: [] }, earlierGuests: [], earlierReceipts: [], ...over };
}

const status = (r: ReturnType<typeof reconcileDay>, key: string) => r.checks.find((c) => c.key === key)?.status;

describe("normalisers", () => {
  it("reads payment methods as written", () => {
    expect(normalizeMethod("Cash")).toBe("cash");
    expect(normalizeMethod("Airtel Money")).toBe("airtel");
    expect(normalizeMethod("MTN MoMo")).toBe("mtn");
    expect(normalizeMethod("Money Wise")).toBe("moneywise");
    expect(normalizeMethod("")).toBe("unknown");
  });
  it("reads day-first dates", () => {
    expect(normalizeDate("03/10/2026")).toBe("2026-10-03");
    expect(normalizeDate("2026-10-3")).toBe("2026-10-03");
  });
  it("ignores receipt number punctuation and leading zeros", () => {
    expect(normalizeReceiptNo("No. 0042")).toBe("42");
    expect(normalizeReceiptNo("R-0042")).toBe("R42");
  });
});

describe("matchGuestsToReceipts", () => {
  it("matches by receipt number, then by loose name", () => {
    const { matches } = matchGuestsToReceipts(
      [guest({ guestName: "Mary Banda", receiptNumber: "101" }), guest({ guestName: "John Phiri", room: "4" })],
      [receipt({ guestName: "Phiri John", room: "Room 4" }), receipt({ guestName: "M. Banda", receiptNumber: "0101" })],
    );
    expect(matches[0]).toEqual({ receipts: [1], by: "receipt number" });
    expect(matches[1]).toEqual({ receipts: [0], by: "name" });
  });
  it("treats a second receipt for the same guest as a split payment", () => {
    const { matches } = matchGuestsToReceipts(
      [guest({ guestName: "Mary Banda" })],
      [receipt({ guestName: "Mary Banda", amount: 300 }), receipt({ guestName: "Mary Banda", amount: 200 })],
    );
    expect(matches[0].receipts).toEqual([0, 1]);
  });
});

describe("reconcileDay", () => {
  it("passes a day where everything lines up", () => {
    const r = reconcileDay(
      day({
        guests: [guest({ guestName: "Mary Banda", nights: 2 }), guest({ guestName: "John Phiri", nights: 1 })],
        receipts: [
          receipt({ receiptNumber: "1", guestName: "Mary Banda", nights: 2, amount: 1000, paymentMethod: "cash" }),
          receipt({ receiptNumber: "2", guestName: "John Phiri", nights: 1, amount: 500, paymentMethod: "airtel" }),
        ],
        deposits: [deposit({ amount: 1000, source: "cash" }), deposit({ amount: 500, source: "airtel" })],
        moneywise: {
          ok: true,
          txns: [mw({ amount: 1000, description: "Rcpt 1 Banda" }), mw({ amount: 500, description: "Phiri" })],
        },
      }),
    );
    expect(r.checks.every((c) => c.status === "pass")).toBe(true);
    expect(r.score).toBe(100);
    expect(r.totals.roomNightsSold).toBe(3);
  });

  it("flags an unreceipted guest, a nights mismatch and missing revenue", () => {
    const r = reconcileDay(
      day({
        guests: [guest({ guestName: "Mary Banda", nights: 3 }), guest({ guestName: "Peter Mwale", nights: 1 })],
        receipts: [receipt({ guestName: "Mary Banda", nights: 2, amount: 1000 })],
        deposits: [deposit({ amount: 1000 })],
        moneywise: { ok: true, txns: [] },
      }),
    );
    expect(status(r, "checkInsReceipted")).toBe("fail");
    expect(status(r, "durationsMatch")).toBe("fail");
    expect(status(r, "revenueInMoneyWise")).toBe("fail");
    expect(status(r, "cashflowMatches")).toBe("fail");
    expect(status(r, "cashDeposited")).toBe("pass");
  });

  it("flags undeposited cash", () => {
    const r = reconcileDay(
      day({
        guests: [guest({ guestName: "Mary Banda" })],
        receipts: [receipt({ guestName: "Mary Banda", amount: 800 })],
        deposits: [deposit({ amount: 500 })],
      }),
    );
    expect(status(r, "cashDeposited")).toBe("fail");
    expect(r.checks.find((c) => c.key === "cashDeposited")?.explanation).toContain("undeposited K300.00");
  });

  it("accepts an extension receipt for a guest who checked in earlier", () => {
    const r = reconcileDay(
      day({
        receipts: [receipt({ guestName: "Mary Banda", amount: 500 })],
        earlierGuests: [{ ...guest({ guestName: "Mary Banda", checkIn: "2026-10-26", nights: 2 }), registerDate: "2026-10-26" }],
      }),
    );
    expect(r.receipts[0].guestStatus).toBe("Guest checked in earlier");
    expect(status(r, "receiptsOnRegister")).toBe("pass");
  });

  it("leaves MoneyWise checks out of the score when MoneyWise is unreachable", () => {
    const r = reconcileDay(
      day({
        guests: [guest({ guestName: "Mary Banda" })],
        receipts: [receipt({ guestName: "Mary Banda", amount: 500 })],
        deposits: [deposit({ amount: 500 })],
        moneywise: { ok: false, reason: "MoneyWise is not connected." },
      }),
    );
    expect(status(r, "revenueInMoneyWise")).toBe("warning");
    expect(r.score).toBe(100);
  });
});

describe("buildMasterRegister", () => {
  it("marks stays paid, part paid or unpaid and who is in house", () => {
    const lines = buildMasterRegister(
      "2026-10-28",
      [
        { ...guest({ guestName: "Mary Banda", checkIn: "2026-10-27", nights: 3 }), registerDate: "2026-10-27" },
        { ...guest({ guestName: "John Phiri", checkIn: "2026-10-27", nights: 1 }), registerDate: "2026-10-27" },
        { ...guest({ guestName: "Peter Mwale", checkIn: "2026-10-28", nights: 2 }), registerDate: "2026-10-28" },
      ],
      [
        { ...receipt({ guestName: "Mary Banda", nights: 2, amount: 1000, date: "2026-10-27" }), reportDate: "2026-10-27" },
        { ...receipt({ guestName: "John Phiri", nights: 1, amount: 500, date: "2026-10-27" }), reportDate: "2026-10-27" },
      ],
    );
    const by = Object.fromEntries(lines.map((l) => [l.guestName, l]));
    expect(by["Mary Banda"]).toMatchObject({ status: "Part paid", inHouse: true });
    expect(by["John Phiri"]).toMatchObject({ status: "Paid", inHouse: false });
    expect(by["Peter Mwale"]).toMatchObject({ status: "Unpaid", inHouse: true });
  });

  it("compares register amount to the receipt when receipts show no nights", () => {
    const D = "2026-09-25";
    const guest = { guestName: "Manasseh Banda", room: "Room 1", checkIn: D, checkOut: "2026-10-01", nights: null, guests: 1, phone: null, receiptNumber: null, amount: 2700, paymentMethod: null };
    const rec = (amount: number) => ({ receiptNumber: "149", date: D, guestName: "Manasseh Banda", room: null, checkIn: null, checkOut: null, nights: null, amount, paymentMethod: "unknown" as const, methodWritten: null });
    const run = (amount: number) =>
      reconcileDay({ date: D, guests: [guest], receipts: [rec(amount)], deposits: [{ date: D, amount: 2700, source: "cash", destination: null, reference: null }], moneywise: { ok: false, reason: "x" }, earlierGuests: [], earlierReceipts: [] });
    const ok = run(2700);
    expect(ok.guests[0].registerNights).toBe(6);
    expect(ok.checks.find((c) => c.key === "durationsMatch")?.status).toBe("pass");
    expect(ok.checks.find((c) => c.key === "cashDeposited")?.status).toBe("warning");
    expect(run(2250).checks.find((c) => c.key === "durationsMatch")?.status).toBe("fail");
  });
});
