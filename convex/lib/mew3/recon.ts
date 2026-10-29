import { nameCost, nameTokens } from "../canteenValidity";
import type { Deposit, GuestStay, MoneyChannel, MwTxn, PaymentMethod, Receipt } from "./types";

/**
 * MEW3 Apartments daily reconciliation.
 *
 * For one day it lines up three documents the Finance team submits — the
 * guest register, the receipts issued and the proof of deposit — with what
 * was recorded in MoneyWise, and answers: was every guest who checked in
 * receipted, for the right number of nights; is every receipt booked as
 * revenue in MoneyWise; was the cash and mobile money banked; and did
 * MoneyWise's inflows rise by what was collected.
 *
 * Nothing here touches the database or the network, so it is unit-tested
 * directly (recon.test.ts).
 */

/** Kwacha difference treated as a match — handwriting and rounding, not missing money. */
export const TOLERANCE = 1;

const DAY_MS = 86_400_000;

// ── Normalising what was written ─────────────────────────────────────────────

export function normalizeMethod(raw: string | null | undefined): PaymentMethod {
  const s = (raw ?? "").toLowerCase();
  if (!s.trim()) return "unknown";
  if (/money\s*wise|\bmwp?\b/.test(s)) return "moneywise";
  if (/airtel/.test(s)) return "airtel";
  if (/\bmtn\b|momo/.test(s)) return "mtn";
  if (/mobile\s*money/.test(s)) return "airtel";
  if (/cash/.test(s)) return "cash";
  if (/card|visa|master|pos|swipe/.test(s)) return "card";
  if (/bank|eft|transfer|zanaco|fnb|absa|stanbic|natsave|deposit/.test(s)) return "bank";
  return "other";
}

export function channelOf(method: PaymentMethod): MoneyChannel {
  if (method === "cash") return "cash";
  if (method === "airtel" || method === "mtn") return "mobile";
  if (method === "moneywise") return "moneywise";
  return "other";
}

/** YYYY-MM-DD from ISO, or from day-first dates (Zambian paperwork writes 03/10/2026 for 3 October). */
export function normalizeDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const dmy = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (dmy) {
    const year = dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3];
    return `${year}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/** Receipt numbers compared without punctuation, prefixes' case or leading zeros: "No. 0042" = "42". */
export function normalizeReceiptNo(raw: string | null | undefined): string | null {
  const s = (raw ?? "").toUpperCase().replace(/^(NO|NUMBER|RCPT|REC|RECEIPT)\b\.?/, "").replace(/[^A-Z0-9]/g, "");
  if (!s) return null;
  return s.replace(/^([A-Z]*)0+(\d)/, "$1$2");
}

/** Nights as written, or worked out from the check-in and check-out dates. */
export function nightsOf(x: { nights: number | null; checkIn: string | null; checkOut: string | null }): number | null {
  if (x.nights !== null && x.nights > 0) return x.nights;
  if (x.checkIn && x.checkOut) {
    const n = daysBetween(x.checkIn, x.checkOut);
    return n > 0 ? n : null;
  }
  return null;
}

const sum = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100) / 100;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;
export const kwacha = (n: number) => `K${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Matching guests to receipts ──────────────────────────────────────────────

const normRoom = (r: string | null) => (r ?? "").toLowerCase().replace(/^(room|rm|unit|apt|apartment|flat)\s*/, "").replace(/[^a-z0-9]/g, "");

/** How unlike a register line and a receipt are, or null when they are not the same guest. */
function pairCost(g: { guestName: string; room: string | null }, r: { guestName: string; room: string | null }): number | null {
  const cost = nameCost(nameTokens(g.guestName), nameTokens(r.guestName));
  if (cost === null) return null;
  const gr = normRoom(g.room);
  const rr = normRoom(r.room);
  if (gr && rr) return gr === rr ? cost - 0.5 : cost + 1;
  return cost;
}

export interface GuestMatch {
  /** Receipts (indices) this register line was paid with — usually one, sometimes split. */
  receipts: number[];
  by: "receipt number" | "name" | null;
}

/**
 * Pairs register lines with receipts: by receipt number where both carry one,
 * then by name (and room, when both give it). A receipt left over after that
 * which names an already-matched guest is treated as a split payment.
 */
export function matchGuestsToReceipts(
  guests: Array<{ guestName: string; room: string | null; receiptNumber: string | null }>,
  receipts: Array<{ guestName: string; room: string | null; receiptNumber: string | null }>,
): { matches: GuestMatch[]; receiptOwner: Array<number | null> } {
  const matches: GuestMatch[] = guests.map(() => ({ receipts: [], by: null }));
  const receiptOwner: Array<number | null> = receipts.map(() => null);
  const assign = (g: number, r: number, by: "receipt number" | "name") => {
    matches[g].receipts.push(r);
    matches[g].by ??= by;
    receiptOwner[r] = g;
  };

  const byNumber = new Map<string, number>();
  receipts.forEach((r, i) => {
    const n = normalizeReceiptNo(r.receiptNumber);
    if (n && !byNumber.has(n)) byNumber.set(n, i);
  });
  guests.forEach((g, gi) => {
    const n = normalizeReceiptNo(g.receiptNumber);
    const ri = n ? byNumber.get(n) : undefined;
    if (ri !== undefined && receiptOwner[ri] === null) assign(gi, ri, "receipt number");
  });

  const candidates: Array<{ g: number; r: number; cost: number }> = [];
  guests.forEach((g, gi) => {
    if (matches[gi].receipts.length) return;
    receipts.forEach((r, ri) => {
      if (receiptOwner[ri] !== null) return;
      const cost = pairCost(g, r);
      if (cost !== null && cost <= 2) candidates.push({ g: gi, r: ri, cost });
    });
  });
  candidates.sort((a, b) => a.cost - b.cost);
  for (const c of candidates) {
    if (matches[c.g].receipts.length || receiptOwner[c.r] !== null) continue;
    assign(c.g, c.r, "name");
  }

  // Split payments: a second receipt for a guest already matched.
  receipts.forEach((r, ri) => {
    if (receiptOwner[ri] !== null) return;
    let best = -1;
    let bestCost = Infinity;
    guests.forEach((g, gi) => {
      if (!matches[gi].receipts.length) return;
      const cost = pairCost(g, r);
      if (cost !== null && cost <= 1 && cost < bestCost) {
        best = gi;
        bestCost = cost;
      }
    });
    if (best >= 0) assign(best, ri, "name");
  });

  return { matches, receiptOwner };
}

// ── Matching receipts to MoneyWise ───────────────────────────────────────────

/**
 * Pairs each receipt with a MoneyWise revenue entry: one that quotes the
 * receipt number first, otherwise one of the same amount — preferring an
 * entry whose description names the guest.
 */
export function matchReceiptsToMoneyWise(receipts: Receipt[], entries: MwTxn[]): Array<number | null> {
  const used = new Set<number>();
  const out: Array<number | null> = receipts.map(() => null);
  const text = entries.map((e) => `${e.description} ${e.reference ?? ""}`.toUpperCase());

  receipts.forEach((r, ri) => {
    const n = normalizeReceiptNo(r.receiptNumber);
    if (!n || n.length < 2) return;
    const hit = entries.findIndex(
      (e, ei) => !used.has(ei) && near(e.amount, r.amount) && text[ei].replace(/[^A-Z0-9]/g, " ").split(" ").some((w) => normalizeReceiptNo(w) === n),
    );
    if (hit >= 0) {
      out[ri] = hit;
      used.add(hit);
    }
  });

  receipts.forEach((r, ri) => {
    if (out[ri] !== null) return;
    const tokens = nameTokens(r.guestName).filter((t) => t.length >= 3);
    let best = -1;
    let bestScore = -1;
    entries.forEach((e, ei) => {
      if (used.has(ei) || !near(e.amount, r.amount)) return;
      const lower = text[ei].toLowerCase();
      const score = tokens.filter((t) => lower.includes(t)).length;
      if (score > bestScore) {
        best = ei;
        bestScore = score;
      }
    });
    if (best >= 0) {
      out[ri] = best;
      used.add(best);
    }
  });
  return out;
}

// ── The day's reconciliation ─────────────────────────────────────────────────

export interface DatedGuest extends GuestStay {
  /** Date of the register this line was submitted on. */
  registerDate: string;
}
export interface DatedReceipt extends Receipt {
  /** Date of the receipts report this receipt was submitted on. */
  reportDate: string;
}

export interface DayInput {
  date: string;
  guests: GuestStay[];
  receipts: Receipt[];
  deposits: Deposit[];
  /** The day's MoneyWise transactions, or why they could not be read. */
  moneywise: { ok: true; txns: MwTxn[] } | { ok: false; reason: string };
  /** Register lines and receipts submitted on earlier days, for stays that span more than one day. */
  earlierGuests: DatedGuest[];
  earlierReceipts: DatedReceipt[];
}

export type CheckStatus = "pass" | "fail" | "warning";

export interface Check {
  key: string;
  title: string;
  status: CheckStatus;
  explanation: string;
  severity: "low" | "medium" | "high" | "critical";
  points: number;
  maxPoints: number;
}

export interface GuestLine {
  guest: GuestStay;
  status: "Receipted" | "Paid on an earlier receipt" | "No receipt";
  receiptNumbers: string;
  registerNights: number | null;
  receiptedNights: number | null;
  receiptedAmount: number;
  nightsAgree: boolean | null;
  note: string;
}

export interface ReceiptLine {
  receipt: Receipt;
  channel: MoneyChannel;
  guestStatus: "On today's register" | "Guest checked in earlier" | "Not on any register";
  moneywiseEntry: string | null;
}

export interface MasterLine {
  guestName: string;
  room: string | null;
  registerDate: string;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  receiptedNights: number;
  amountPaid: number;
  receiptNumbers: string;
  status: "Paid" | "Part paid" | "Unpaid";
  inHouse: boolean;
}

export interface DayResult {
  date: string;
  checks: Check[];
  score: number;
  guests: GuestLine[];
  receipts: ReceiptLine[];
  moneywise: Array<MwTxn & { matchedReceipt: string | null }>;
  totals: {
    checkIns: number;
    guestsReceipted: number;
    unreceiptedGuests: number;
    receiptCount: number;
    receiptsWithoutGuest: number;
    nightsMismatches: number;
    roomNightsSold: number;
    totalReceipted: number;
    byChannel: Record<MoneyChannel, number>;
    cashDeposited: number;
    mobileDeposited: number;
    otherDeposited: number;
    unspecifiedDeposited: number;
    totalDeposited: number;
    mwRevenue: number | null;
    mwInflows: number | null;
    receiptsNotInMoneyWise: number | null;
  };
}

const receiptLabel = (r: Receipt) => (r.receiptNumber ? `#${r.receiptNumber}` : `${r.guestName} ${kwacha(r.amount)}`);

function check(
  key: string,
  title: string,
  maxPoints: number,
  status: CheckStatus,
  explanation: string,
  severity: Check["severity"],
): Check {
  return { key, title, status, explanation, severity, points: status === "fail" ? 0 : maxPoints, maxPoints };
}

/** Lists up to five names, then "and N more". */
function list(names: string[]): string {
  return names.length <= 5 ? names.join(", ") : `${names.slice(0, 5).join(", ")} and ${names.length - 5} more`;
}

export function reconcileDay(input: DayInput): DayResult {
  const { date, guests, receipts, deposits } = input;
  const { matches, receiptOwner } = matchGuestsToReceipts(guests, receipts);

  // A guest with no receipt today may have paid ahead on an earlier one.
  const earlierFor = (g: GuestStay): DatedReceipt[] => {
    const n = normalizeReceiptNo(g.receiptNumber);
    return input.earlierReceipts.filter((r) => {
      if (n && normalizeReceiptNo(r.receiptNumber) === n) return true;
      const cost = pairCost(g, r);
      return cost !== null && cost <= 1 && (!g.checkIn || !r.checkIn || r.checkIn === g.checkIn);
    });
  };
  // A receipt with no guest today may be an extension or balance for someone who checked in earlier.
  const earlierGuestFor = (r: Receipt): DatedGuest | undefined =>
    input.earlierGuests.find((g) => {
      const cost = pairCost(g, r);
      if (cost === null || cost > 1) return false;
      const out = g.checkOut ?? (g.checkIn && nightsOf(g) ? addDays(g.checkIn, nightsOf(g)!) : null);
      return !out || out >= addDays(date, -1);
    });

  const guestLines: GuestLine[] = guests.map((g, gi) => {
    const own = matches[gi].receipts.map((ri) => receipts[ri]);
    const paid = own.length ? own : earlierFor(g);
    const registerNights = nightsOf(g);
    const receiptNights = paid.map((r) => nightsOf(r));
    const receiptedNights = paid.length && receiptNights.every((n) => n !== null) ? sum(receiptNights as number[]) : null;
    const nightsAgree = registerNights !== null && receiptedNights !== null ? registerNights === receiptedNights : null;
    const receiptedAmount = sum(paid.map((r) => r.amount));
    const notes: string[] = [];
    if (g.checkIn && g.checkIn !== date) notes.push(`Register says check-in ${g.checkIn}`);
    if (g.amount !== null && paid.length && !near(g.amount, receiptedAmount))
      notes.push(`Register shows ${kwacha(g.amount)}, receipted ${kwacha(receiptedAmount)}`);
    if (own.length > 1) notes.push(`Paid on ${own.length} receipts`);
    return {
      guest: g,
      status: own.length ? "Receipted" : paid.length ? "Paid on an earlier receipt" : "No receipt",
      receiptNumbers: paid.map((r) => r.receiptNumber ?? "(no number)").join(", "),
      registerNights,
      receiptedNights,
      receiptedAmount,
      nightsAgree,
      note: notes.join("; "),
    };
  });

  const revenueEntries =
    input.moneywise.ok
      ? (() => {
          const inflows = input.moneywise.txns.filter((t) => t.direction === "in");
          // When nothing is categorised as revenue, every inflow is the best evidence there is.
          return inflows.some((t) => t.isRevenue) ? inflows.filter((t) => t.isRevenue) : inflows;
        })()
      : [];
  const mwMatch = input.moneywise.ok ? matchReceiptsToMoneyWise(receipts, revenueEntries) : receipts.map(() => null);

  const receiptLines: ReceiptLine[] = receipts.map((r, ri) => {
    const mw = mwMatch[ri];
    return {
      receipt: r,
      channel: channelOf(r.paymentMethod),
      guestStatus: receiptOwner[ri] !== null ? "On today's register" : earlierGuestFor(r) ? "Guest checked in earlier" : "Not on any register",
      moneywiseEntry: mw === null ? null : revenueEntries[mw].reference ?? revenueEntries[mw].id,
    };
  });

  const mwLines = input.moneywise.ok
    ? input.moneywise.txns.map((t) => {
        const ri = mwMatch.findIndex((m) => m !== null && revenueEntries[m] === t);
        return { ...t, matchedReceipt: ri >= 0 ? receiptLabel(receipts[ri]) : null };
      })
    : [];

  // ── Totals ──
  const byChannel: Record<MoneyChannel, number> = { cash: 0, mobile: 0, moneywise: 0, other: 0 };
  for (const r of receipts) byChannel[channelOf(r.paymentMethod)] += r.amount;
  for (const k of Object.keys(byChannel) as MoneyChannel[]) byChannel[k] = sum([byChannel[k]]);
  const totalReceipted = sum(receipts.map((r) => r.amount));

  const depositOf = (pred: (d: Deposit) => boolean) => sum(deposits.filter(pred).map((d) => d.amount));
  const cashDeposited = depositOf((d) => d.source === "cash");
  const mobileDeposited = depositOf((d) => channelOf(d.source) === "mobile");
  const unspecifiedDeposited = depositOf((d) => d.source === "unknown");
  const otherDeposited = depositOf((d) => d.source !== "cash" && d.source !== "unknown" && channelOf(d.source) !== "mobile");
  const totalDeposited = sum(deposits.map((d) => d.amount));

  const unreceipted = guestLines.filter((l) => l.status === "No receipt");
  const orphanReceipts = receiptLines.filter((l) => l.guestStatus === "Not on any register");
  const nightsMismatches = guestLines.filter((l) => l.nightsAgree === false);
  const roomNightsSold = sum(guestLines.map((l) => l.registerNights ?? l.receiptedNights ?? 0));

  const checks: Check[] = [];

  // A. Every check-in receipted.
  checks.push(
    guests.length === 0
      ? check("checkInsReceipted", "Every check-in has a receipt", 20, receipts.length ? "warning" : "pass",
          receipts.length ? "The guest register lists no check-ins, but receipts were issued — check the register was complete." : "No check-ins and no receipts today.", "medium")
      : unreceipted.length === 0
        ? check("checkInsReceipted", "Every check-in has a receipt", 20, "pass",
            `All ${guests.length} check-ins on the register were receipted (${guests.length} guests, ${receipts.length} receipts).`, "low")
        : check("checkInsReceipted", "Every check-in has a receipt", 20, "fail",
            `${unreceipted.length} of ${guests.length} check-ins have no receipt: ${list(unreceipted.map((l) => l.guest.guestName))}.`, "critical"),
  );

  // B. Every receipt belongs to a guest on a register.
  checks.push(
    orphanReceipts.length === 0
      ? check("receiptsOnRegister", "Every receipt matches a registered guest", 10, "pass",
          receipts.length ? `All ${receipts.length} receipts match a guest on the register.` : "No receipts were issued.", "low")
      : check("receiptsOnRegister", "Every receipt matches a registered guest", 10, "fail",
          `${orphanReceipts.length} receipts match nobody on today's or a recent register: ${list(orphanReceipts.map((l) => receiptLabel(l.receipt)))}.`, "high"),
  );

  // C. Durations agree.
  const comparable = guestLines.filter((l) => l.nightsAgree !== null).length;
  checks.push(
    nightsMismatches.length > 0
      ? check("durationsMatch", "Stay durations match the receipts", 15, "fail",
          `Nights differ for ${nightsMismatches.length} guests: ${list(nightsMismatches.map((l) => `${l.guest.guestName} (register ${l.registerNights}, receipt ${l.receiptedNights})`))}.`, "high")
      : comparable === 0
        ? check("durationsMatch", "Stay durations match the receipts", 15, guests.length ? "warning" : "pass",
            guests.length ? "Nights could not be compared — the register or the receipts do not show the length of stay." : "No stays to compare.", "medium")
        : check("durationsMatch", "Stay durations match the receipts", 15, comparable < guestLines.length - unreceipted.length ? "warning" : "pass",
            `Nights agree for all ${comparable} stays that show them.` + (comparable < guestLines.length - unreceipted.length ? " Some stays do not show a length on one of the documents." : ""), "low"),
  );

  // D. Revenue recorded in MoneyWise.
  let mwRevenue: number | null = null;
  let mwInflows: number | null = null;
  let receiptsNotInMoneyWise: number | null = null;
  if (!input.moneywise.ok) {
    checks.push(check("revenueInMoneyWise", "Receipts recorded as revenue in MoneyWise", 20, "warning", `Not checked: ${input.moneywise.reason}`, "medium"));
    checks.push(check("cashflowMatches", "MoneyWise inflows match the money collected", 15, "warning", `Not checked: ${input.moneywise.reason}`, "medium"));
  } else {
    mwRevenue = sum(revenueEntries.map((t) => t.amount));
    mwInflows = sum(input.moneywise.txns.filter((t) => t.direction === "in").map((t) => t.amount));
    const missing = receiptLines.filter((l) => l.moneywiseEntry === null);
    receiptsNotInMoneyWise = missing.length;
    const diff = sum([mwRevenue - totalReceipted]);
    checks.push(
      near(mwRevenue, totalReceipted) && missing.length === 0
        ? check("revenueInMoneyWise", "Receipts recorded as revenue in MoneyWise", 20, "pass",
            `MoneyWise revenue for the day is ${kwacha(mwRevenue)}, the same as the ${receipts.length} receipts.`, "low")
        : near(mwRevenue, totalReceipted)
          ? check("revenueInMoneyWise", "Receipts recorded as revenue in MoneyWise", 20, "warning",
              `Totals agree at ${kwacha(mwRevenue)}, but ${missing.length} receipts could not be paired with a MoneyWise entry one-for-one: ${list(missing.map((l) => receiptLabel(l.receipt)))}.`, "medium")
          : check("revenueInMoneyWise", "Receipts recorded as revenue in MoneyWise", 20, "fail",
              `Receipts total ${kwacha(totalReceipted)} but MoneyWise revenue is ${kwacha(mwRevenue)} (${diff > 0 ? "over" : "short"} by ${kwacha(Math.abs(diff))}).` +
                (missing.length ? ` Not found in MoneyWise: ${list(missing.map((l) => receiptLabel(l.receipt)))}.` : ""), "critical"),
    );
  }

  // E. Cash banked.
  const cashAvailable = sum([cashDeposited + unspecifiedDeposited]);
  checks.push(
    byChannel.cash === 0 && cashDeposited === 0
      ? check("cashDeposited", "Cash takings deposited", 10, "pass", "No cash was taken today.", "low")
      : near(byChannel.cash, cashDeposited)
        ? check("cashDeposited", "Cash takings deposited", 10, "pass", `Cash receipted and cash deposited are both ${kwacha(byChannel.cash)}.`, "low")
        : near(byChannel.cash, cashAvailable)
          ? check("cashDeposited", "Cash takings deposited", 10, "warning",
              `Cash receipted is ${kwacha(byChannel.cash)}; that balances only if the ${kwacha(unspecifiedDeposited)} deposited without a stated source was cash.`, "medium")
          : check("cashDeposited", "Cash takings deposited", 10, "fail",
              `Cash receipted is ${kwacha(byChannel.cash)} but cash deposited is ${kwacha(cashDeposited)}` +
                (unspecifiedDeposited ? ` (plus ${kwacha(unspecifiedDeposited)} with no stated source)` : "") +
                ` — ${byChannel.cash > cashAvailable ? "undeposited" : "over-deposited"} ${kwacha(Math.abs(byChannel.cash - cashAvailable))}.`, "critical"),
  );

  // F. Mobile money banked.
  checks.push(
    byChannel.mobile === 0 && mobileDeposited === 0
      ? check("mobileDeposited", "Mobile money transferred to MoneyWise", 10, "pass", "No mobile money was taken today.", "low")
      : near(byChannel.mobile, mobileDeposited)
        ? check("mobileDeposited", "Mobile money transferred to MoneyWise", 10, "pass", `Mobile money receipted and transferred are both ${kwacha(byChannel.mobile)}.`, "low")
        : check("mobileDeposited", "Mobile money transferred to MoneyWise", 10, "fail",
            `Mobile money receipted is ${kwacha(byChannel.mobile)} but the proof of deposit shows ${kwacha(mobileDeposited)} transferred.`, "high"),
  );

  // G. MoneyWise cash flow.
  if (input.moneywise.ok && mwInflows !== null) {
    const diff = sum([mwInflows - totalReceipted]);
    checks.push(
      near(mwInflows, totalReceipted)
        ? check("cashflowMatches", "MoneyWise inflows match the money collected", 15, "pass",
            `MoneyWise received ${kwacha(mwInflows)}, matching cash ${kwacha(byChannel.cash)} + mobile ${kwacha(byChannel.mobile)} + MoneyWise ${kwacha(byChannel.moneywise)}` +
              (byChannel.other ? ` + other ${kwacha(byChannel.other)}` : "") + ".", "low")
        : check("cashflowMatches", "MoneyWise inflows match the money collected", 15, "fail",
            `MoneyWise received ${kwacha(mwInflows)} but ${kwacha(totalReceipted)} was collected (cash ${kwacha(byChannel.cash)}, mobile ${kwacha(byChannel.mobile)}, MoneyWise ${kwacha(byChannel.moneywise)}` +
              (byChannel.other ? `, other ${kwacha(byChannel.other)}` : "") + `) — ${diff > 0 ? "more" : "less"} by ${kwacha(Math.abs(diff))}.`, "critical"),
    );
  }

  // Checks MoneyWise could not answer are left out of the score rather than counted against Finance.
  const scored = checks.filter((c) => !(c.status === "warning" && c.explanation.startsWith("Not checked")));
  const max = sum(scored.map((c) => c.maxPoints));
  const earned = sum(scored.map((c) => c.points));
  const score = max === 0 ? 100 : Math.round((earned / max) * 100);

  return {
    date,
    checks,
    score,
    guests: guestLines,
    receipts: receiptLines,
    moneywise: mwLines,
    totals: {
      checkIns: guests.length,
      guestsReceipted: guestLines.length - unreceipted.length,
      unreceiptedGuests: unreceipted.length,
      receiptCount: receipts.length,
      receiptsWithoutGuest: orphanReceipts.length,
      nightsMismatches: nightsMismatches.length,
      roomNightsSold,
      totalReceipted,
      byChannel,
      cashDeposited,
      mobileDeposited,
      otherDeposited,
      unspecifiedDeposited,
      totalDeposited,
      mwRevenue,
      mwInflows,
      receiptsNotInMoneyWise,
    },
  };
}

// ── Master register ──────────────────────────────────────────────────────────

/**
 * Every stay on every register up to `date`, with what has been paid against
 * it — the running "who is paying and who is not" list. A receipt is claimed
 * by one stay only: the guest's, issued between two weeks before check-in and
 * check-out.
 */
export function buildMasterRegister(date: string, guests: DatedGuest[], receipts: DatedReceipt[]): MasterLine[] {
  const stays = guests
    .filter((g) => g.registerDate <= date)
    .sort((a, b) => (a.checkIn ?? a.registerDate).localeCompare(b.checkIn ?? b.registerDate));
  const claimed = new Set<number>();

  return stays.map((g) => {
    const checkIn = g.checkIn ?? g.registerDate;
    const nights = nightsOf(g);
    const checkOut = g.checkOut ?? (nights ? addDays(checkIn, nights) : null);
    const n = normalizeReceiptNo(g.receiptNumber);
    const paid: DatedReceipt[] = [];
    receipts.forEach((r, i) => {
      if (claimed.has(i) || r.reportDate > date) return;
      const issued = r.date ?? r.reportDate;
      const byNumber = n !== null && normalizeReceiptNo(r.receiptNumber) === n;
      const cost = pairCost(g, r);
      const inWindow = issued >= addDays(checkIn, -14) && (!checkOut || issued <= checkOut);
      if (byNumber || (cost !== null && cost <= 1 && inWindow)) {
        paid.push(r);
        claimed.add(i);
      }
    });
    const receiptedNights = sum(paid.map((r) => nightsOf(r) ?? 0));
    const amountPaid = sum(paid.map((r) => r.amount));
    const status: MasterLine["status"] =
      paid.length === 0 ? "Unpaid" : nights === null || receiptedNights >= nights || receiptedNights === 0 ? "Paid" : "Part paid";
    return {
      guestName: g.guestName,
      room: g.room,
      registerDate: g.registerDate,
      checkIn,
      checkOut,
      nights,
      receiptedNights,
      amountPaid,
      receiptNumbers: paid.map((r) => r.receiptNumber ?? "(no number)").join(", "),
      status,
      inHouse: checkIn <= date && (checkOut === null ? checkIn === date : date < checkOut),
    };
  });
}
