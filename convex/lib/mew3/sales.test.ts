import { describe, expect, it } from "vitest";
import { findInMoneyWise, ledgerFor, planSales, saleItemName, saleKey, saleRequest } from "./sales";
import type { GuestStay, MwTxn, Receipt } from "./types";

const D = "2026-11-08";
const receipt = (over: Partial<Receipt>): Receipt => ({
  receiptNumber: null, date: D, guestName: "Svea Hannekum", room: null, checkIn: null, checkOut: null,
  nights: null, amount: 950, paymentMethod: "unknown", methodWritten: null, ...over,
});
const guest = (over: Partial<GuestStay>): GuestStay => ({
  guestName: "Svea Hannekum", room: "4", checkIn: D, checkOut: "2026-11-09", nights: 1, guests: 1,
  phone: "+260971000000", receiptNumber: null, amount: 950, paymentMethod: null, ...over,
});
const mw = (over: Partial<MwTxn>): MwTxn => ({
  id: "e1", date: D, amount: 950, direction: "in", description: "Sale: Accommodation – Someone Else", reference: "REC-1",
  category: "Accommodation Revenue", wallet: "Cash", isRevenue: true, ...over,
});

describe("MEW3 sales for MoneyWise", () => {
  it("maps only clear payment methods to a ledger", () => {
    expect(ledgerFor("cash")).toBe("CASH");
    expect(ledgerFor("airtel")).toBe("AIRTEL_MONEY");
    expect(ledgerFor("unknown")).toBeNull();
    expect(ledgerFor("other")).toBeNull();
  });

  it("keys by receipt number, else by name and amount", () => {
    expect(saleKey(D, receipt({ receiptNumber: "No. 0167" }))).toBe(`kaizen:mew3:${D}:r167`);
    expect(saleKey(D, receipt({}))).toBe(`kaizen:mew3:${D}:svea-hannekum-95000`);
  });

  it("fills phone, room and dates from the register", () => {
    const [s] = planSales(D, [receipt({ paymentMethod: "cash" })], [guest({})], []);
    expect(s).toMatchObject({ phone: "+260971000000", room: "4", checkIn: D, checkOut: "2026-11-09", ledger: "CASH", existingEntry: null });
    expect(saleItemName(s)).toBe("Accommodation – Svea Hannekum (Room 4, 08 Nov–09 Nov)");
  });

  it("does not take a same-amount sale for another guest as already entered", () => {
    expect(findInMoneyWise([receipt({})], [mw({})])).toEqual([null]);
  });

  it("recognises a hand-entered sale by guest name or receipt number", () => {
    expect(findInMoneyWise([receipt({})], [mw({ description: "Sale: Accommodation – Svea Hannekum (Room 4)" })])).toEqual([0]);
    expect(findInMoneyWise([receipt({ guestName: "Bob", receiptNumber: "161" })], [mw({ description: "Sale: ... Receipt #161" })])).toEqual([0]);
    expect(planSales(D, [receipt({})], [], [mw({ description: "Svea Hannekum", reference: "REC-9" })])[0].existingEntry).toBe("REC-9");
  });

  it("gives identical unnumbered receipts distinct keys", () => {
    const keys = planSales(D, [receipt({}), receipt({})], [], []).map((s) => s.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("builds the POST /sales body", () => {
    const [s] = planSales(D, [receipt({ receiptNumber: "170", paymentMethod: "airtel" })], [guest({})], []);
    expect(saleRequest(D, { ...s, ledger: "AIRTEL_MONEY" })).toEqual({
      external_reference: `kaizen:mew3:${D}:r170`, date: D, amount: 950, account_type: "AIRTEL_MONEY",
      customer_name: "Svea Hannekum", customer_phone: "+260971000000",
      items: [{ name: "Accommodation – Svea Hannekum (Room 4, 08 Nov–09 Nov, Receipt #170)", income_account: "Accommodation Revenue", quantity: 1, price: 950 }],
    });
  });
});
