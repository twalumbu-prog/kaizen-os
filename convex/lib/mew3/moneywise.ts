import type { MwTxn } from "./types";

/**
 * Turns a raw MoneyWise transaction into what the reconciliation needs.
 *
 * The field names below are a best reading of the MoneyWise Pro API — several
 * spellings are accepted for each — and the reconciliation workbook lists
 * every transaction as read, so a field read wrongly shows up there.
 */

/** MEW3 runs on Lusaka time (UTC+2); a timestamp's calendar day is taken there. */
const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;

type Obj = Record<string, unknown>;

const pick = (o: Obj, keys: string[]): unknown => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const text = (x: unknown): string | null => {
  if (typeof x === "string") return x.trim() || null;
  if (typeof x === "number") return String(x);
  if (x && typeof x === "object") return text(pick(x as Obj, ["name", "title", "label"]));
  return null;
};

export function lusakaDate(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const t = typeof raw === "number" ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t + LUSAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function normalizeMwTxn(raw: unknown, index: number): MwTxn | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Obj;
  if (typeof o.debit === "number" || typeof o.credit === "number") return fromCashbook(o, index);
  const rawAmount = pick(o, ["amount", "value", "total", "net_amount"]);
  const signed = typeof rawAmount === "number" ? rawAmount : typeof rawAmount === "string" ? Number(rawAmount.replace(/[^0-9.\-]/g, "")) : NaN;
  if (!Number.isFinite(signed) || signed === 0) return null;

  const kind = (text(pick(o, ["direction", "type", "transaction_type", "kind", "flow", "entry_type"])) ?? "").toLowerCase();
  const direction: "in" | "out" = /credit|\bin\b|inflow|income|incoming|deposit|receive|received|revenue|sale|top.?up|collection/.test(kind)
    ? "in"
    : /debit|\bout\b|outflow|expense|outgoing|withdraw|transfer.?out|payout|disburse/.test(kind)
      ? "out"
      : signed > 0 ? "in" : "out";

  const category = text(pick(o, ["category", "category_name", "account", "account_name", "ledger_account", "gl_account"]));
  const description = text(pick(o, ["description", "narration", "memo", "note", "notes", "title", "details"])) ?? "";
  return {
    id: text(pick(o, ["id", "uuid", "transaction_id", "reference"])) ?? `row-${index + 1}`,
    date: lusakaDate(pick(o, ["transaction_date", "date", "value_date", "posted_at", "completed_at", "created_at"])),
    amount: Math.abs(signed),
    direction,
    description,
    reference: text(pick(o, ["reference", "ref", "receipt_number", "external_reference", "external_id"])),
    category,
    wallet: text(pick(o, ["wallet", "wallet_name", "external_wallet", "account_wallet", "source"])),
    isRevenue: /revenue|income|sales?\b|accommodation|lodging|rent|room/i.test(`${category ?? ""} ${kind}`),
  };
}

const LEDGER_NAMES: Record<string, string> = {
  MONEYWISE_WALLET: "MoneyWise Wallet",
  CASH: "Cash",
  AIRTEL_MONEY: "Airtel Money",
  BANK: "Bank",
};

/**
 * A MoneyWise Pro cashbook entry, as GET /transactions returns it. Debit is money
 * coming into the ledger, credit money leaving it. Sales are INFLOW entries,
 * described "Sale: ..." and booked against an income account; adjustments and
 * opening balances move money between ledgers and are not takings.
 */
function fromCashbook(o: Obj, index: number): MwTxn | null {
  const debit = Number(o.debit ?? 0) || 0;
  const credit = Number(o.credit ?? 0) || 0;
  if (debit === 0 && credit === 0) return null;
  const type = String(o.type ?? o.entry_type ?? "").toUpperCase();
  const account = o.account && typeof o.account === "object" ? (o.account as Obj) : null;
  const category = text(account?.name) ?? null;
  const payer = text(o.payer_name);
  const description = [text(o.description), payer ? `from ${payer}` : null].filter(Boolean).join(" ");
  const inflow = debit > 0 && (type === "INFLOW" || type === "");
  const isRevenue =
    inflow &&
    (/^sale:/i.test(text(o.description) ?? "") ||
      /revenue|income|sales?\b|accommodation|lodging|rent|room/i.test(category ?? "") ||
      !/transfer|deposit|withdraw|float|top.?up/i.test(description));
  const ledger = text(o.ledger);
  return {
    id: text(o.id) ?? `row-${index + 1}`,
    date: lusakaDate(o.date ?? o.created_at),
    amount: debit > 0 ? debit : credit,
    direction: debit > 0 ? (inflow ? "in" : "transfer") : "out",
    description,
    reference: text(o.reference) ?? text(o.external_reference),
    category,
    wallet: ledger ? (LEDGER_NAMES[ledger] ?? ledger) : null,
    isRevenue,
  };
}
