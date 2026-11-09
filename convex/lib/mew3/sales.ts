import type { GuestStay, MwTxn, PaymentMethod, Receipt } from "./types";
import { TOLERANCE, matchGuestsToReceipts, normalizeReceiptNo } from "./recon";

/**
 * Turning a day's receipts into MoneyWise sales. Finance approves the day in
 * Kaizen first; only then are the sales posted (POST /api/v1/sales).
 */

/** The MoneyWise ledger a sale's money landed in. */
export type SaleLedger = "CASH" | "AIRTEL_MONEY" | "BANK";

export const LEDGER_LABELS: Record<SaleLedger, string> = { CASH: "Cash", AIRTEL_MONEY: "Airtel Money", BANK: "Bank" };

/** Where the receipt's method clearly names a ledger; null when Finance has to say. */
export function ledgerFor(method: PaymentMethod | null | undefined): SaleLedger | null {
  if (method === "cash") return "CASH";
  if (method === "airtel") return "AIRTEL_MONEY";
  if (method === "bank") return "BANK";
  return null;
}

export interface PlannedSale {
  /** Stable per receipt, sent as MoneyWise's external_reference so a sale is never posted twice. */
  key: string;
  receiptNumber: string | null;
  guestName: string;
  phone: string | null;
  room: string | null;
  checkIn: string | null;
  checkOut: string | null;
  amount: number;
  ledger: SaleLedger | null;
  /** The MoneyWise entry already recording this receipt (entered by hand), if any. */
  existingEntry: string | null;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "guest";

/** Receipt numbers are unique in the book; when one is unreadable, name + amount stands in. */
export function saleKey(date: string, r: Pick<Receipt, "receiptNumber" | "guestName" | "amount">): string {
  const n = normalizeReceiptNo(r.receiptNumber);
  return `kaizen:mew3:${date}:${n ? `r${n}` : `${slug(r.guestName)}-${Math.round(r.amount * 100)}`}`;
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

/**
 * Which MoneyWise inflow (if any) already records each receipt. Stricter than the
 * reconciliation's pairing: the amount must agree AND the entry must name the
 * receipt number or the guest, since a false match here means a sale never gets posted.
 */
export function findInMoneyWise(receipts: Array<Pick<Receipt, "receiptNumber" | "guestName" | "amount">>, entries: MwTxn[]): Array<number | null> {
  const used = new Set<number>();
  const text = entries.map((e) => `${e.description} ${e.reference ?? ""}`);
  const pick = (ri: number, test: (ei: number) => boolean) => {
    const r = receipts[ri];
    const hit = entries.findIndex((e, ei) => !used.has(ei) && Math.abs(e.amount - r.amount) <= TOLERANCE && test(ei));
    if (hit < 0) return null;
    used.add(hit);
    return hit;
  };
  const out: Array<number | null> = receipts.map(() => null);
  receipts.forEach((r, ri) => {
    const n = normalizeReceiptNo(r.receiptNumber);
    if (n && n.length >= 2) out[ri] = pick(ri, (ei) => text[ei].toUpperCase().split(/[^A-Z0-9]+/).some((w) => normalizeReceiptNo(w) === n));
  });
  receipts.forEach((r, ri) => {
    if (out[ri] !== null) return;
    const names = words(r.guestName).filter((w) => !["mr", "mrs", "miss", "the", "group", "ltd"].includes(w));
    if (names.length) out[ri] = pick(ri, (ei) => names.some((w) => text[ei].toLowerCase().includes(w)));
  });
  return out;
}

export function planSales(date: string, receipts: Receipt[], guests: GuestStay[], moneywise: MwTxn[]): PlannedSale[] {
  const { receiptOwner } = matchGuestsToReceipts(guests, receipts);
  const revenue = moneywise.filter((t) => t.direction === "in");
  const inMw = findInMoneyWise(receipts, revenue);
  const seen = new Map<string, number>();
  return receipts
    .filter((r) => r.amount > 0)
    .map((r) => {
      const i = receipts.indexOf(r);
      const g = receiptOwner[i] === null ? null : guests[receiptOwner[i]!];
      let key = saleKey(date, r);
      // Two identical unnumbered receipts on one day still need distinct keys.
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n > 1) key = `${key}-${n}`;
      const hit = inMw[i];
      return {
        key,
        receiptNumber: r.receiptNumber,
        guestName: r.guestName || g?.guestName || "Guest",
        phone: g?.phone ?? null,
        room: r.room ?? g?.room ?? null,
        checkIn: r.checkIn ?? g?.checkIn ?? null,
        checkOut: r.checkOut ?? g?.checkOut ?? null,
        amount: r.amount,
        ledger: ledgerFor(r.paymentMethod) ?? ledgerFor(g?.paymentMethod),
        existingEntry: hit === null ? null : (revenue[hit].reference ?? revenue[hit].id),
      };
    });
}

const shortDate = (d: string) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) ? d : new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });
};

/** The line name, matching how Finance has been writing sales by hand. */
export function saleItemName(s: Pick<PlannedSale, "guestName" | "room" | "checkIn" | "checkOut" | "receiptNumber">): string {
  const bits = [
    s.room ? `Room ${s.room.replace(/^room\s*/i, "")}` : null,
    s.checkIn && s.checkOut ? `${shortDate(s.checkIn)}–${shortDate(s.checkOut)}` : s.checkIn ? shortDate(s.checkIn) : null,
    s.receiptNumber ? `Receipt #${s.receiptNumber}` : null,
  ].filter(Boolean);
  return `Accommodation – ${s.guestName}${bits.length ? ` (${bits.join(", ")})` : ""}`.slice(0, 200);
}

/** The POST /api/v1/sales body for an approved sale. */
export function saleRequest(date: string, s: PlannedSale & { ledger: SaleLedger }) {
  return {
    external_reference: s.key,
    date,
    amount: s.amount,
    account_type: s.ledger,
    ...(s.guestName ? { customer_name: s.guestName } : {}),
    ...(s.phone ? { customer_phone: s.phone } : {}),
    items: [{ name: saleItemName(s), income_account: "Accommodation Revenue", quantity: 1, price: s.amount }],
  };
}
