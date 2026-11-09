import * as XLSX from "xlsx";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { periodContaining } from "./lib/periods";
import { addDays, buildMasterRegister, kwacha, reconcileDay } from "./lib/mew3/recon";
import type { DatedGuest, DatedReceipt, DayInput, DayResult, MasterLine } from "./lib/mew3/recon";
import { normalizeMwTxn } from "./lib/mew3/moneywise";
import type { Deposit, GuestStay, MwTxn, Receipt } from "./lib/mew3/types";

/**
 * MEW3 Apartments daily reconciliation automation.
 *
 * Runs when Finance submits any of the day's three documents (guest
 * register, receipts, proof of deposit) and, once all three have been read,
 * reconciles the day against MoneyWise (lib/mew3/recon.ts) and submits a
 * workbook to the Daily Reconciliation report. Each morning it re-checks the
 * two previous days, since revenue is often entered in MoneyWise late; a rerun
 * replaces that day's workbook.
 */

const DAY_MS = 86_400_000;
const LABELS = { guestRegister: "Guest register", receipts: "Receipts", deposits: "Proof of deposit" } as const;

// ── Workbook ─────────────────────────────────────────────────────────────────

const yesNo = (b: boolean | null) => (b === null ? "" : b ? "Yes" : "No");

export function buildWorkbook(r: DayResult, master: MasterLine[], mwNote: string) {
  const t = r.totals;
  const failed = r.checks.filter((c) => c.status === "fail").length;

  const checksWs = XLSX.utils.aoa_to_sheet([
    [`MEW3 Apartments — daily reconciliation for ${r.date}`],
    [`Score ${r.score}% · ${r.checks.length - failed} of ${r.checks.length} checks passed or noted`],
    [],
    ["Check", "Result", "Detail"],
    ...r.checks.map((c) => [c.title, c.status.toUpperCase(), c.explanation]),
    [],
    ["Sales reconciliation"],
    ["Check-ins on the register", t.checkIns],
    ["Guests receipted", t.guestsReceipted],
    ["Receipts issued", t.receiptCount],
    ["Room nights sold", t.roomNightsSold],
    ["Total receipted", t.totalReceipted],
    ["  Cash", t.byChannel.cash],
    ["  Mobile money (Airtel/MTN)", t.byChannel.mobile],
    ["  Paid into MoneyWise", t.byChannel.moneywise],
    ["  Other (bank, card, unstated)", t.byChannel.other],
    ["Average per room night", t.roomNightsSold ? Math.round((t.totalReceipted / t.roomNightsSold) * 100) / 100 : ""],
    [],
    ["Cash & mobile money reconciliation", "Receipted", "Deposited", "Difference"],
    ["Cash", t.byChannel.cash, t.cashDeposited, Math.round((t.byChannel.cash - t.cashDeposited) * 100) / 100],
    ["Mobile money", t.byChannel.mobile, t.mobileDeposited, Math.round((t.byChannel.mobile - t.mobileDeposited) * 100) / 100],
    ["Deposits with no stated source", "", t.unspecifiedDeposited, ""],
    ["Other deposits", "", t.otherDeposited, ""],
    [],
    ["MoneyWise reconciliation", "Expected", "In MoneyWise", "Difference"],
    ["Revenue recorded", t.totalReceipted, t.mwRevenue ?? "n/a", t.mwRevenue === null ? "" : Math.round((t.mwRevenue - t.totalReceipted) * 100) / 100],
    ["Inflows (cash flow)", t.totalReceipted, t.mwInflows ?? "n/a", t.mwInflows === null ? "" : Math.round((t.mwInflows - t.totalReceipted) * 100) / 100],
    [mwNote],
  ]);
  checksWs["!cols"] = [{ wch: 44 }, { wch: 14 }, { wch: 100 }, { wch: 12 }];

  const guestsWs = XLSX.utils.aoa_to_sheet([
    ["Guest", "Room", "Check-in", "Check-out", "People", "Status", "Receipt no.", "Nights (register)", "Nights (receipt)", "Nights agree", "Amount receipted", "Note"],
    ...r.guests.map((l) => [
      l.guest.guestName, l.guest.room ?? "", l.guest.checkIn ?? "", l.guest.checkOut ?? "", l.guest.guests ?? "",
      l.status, l.receiptNumbers, l.registerNights ?? "", l.receiptedNights ?? "", yesNo(l.nightsAgree), l.receiptedAmount || "", l.note,
    ]),
  ]);
  guestsWs["!cols"] = [28, 8, 11, 11, 7, 24, 14, 9, 9, 8, 12, 60].map((wch) => ({ wch }));

  const receiptsWs = XLSX.utils.aoa_to_sheet([
    ["Receipt no.", "Date", "Guest", "Room", "Nights", "Amount", "Method (written)", "Counted as", "Register", "MoneyWise entry"],
    ...r.receipts.map((l) => [
      l.receipt.receiptNumber ?? "", l.receipt.date ?? "", l.receipt.guestName, l.receipt.room ?? "", l.receipt.nights ?? "",
      l.receipt.amount, l.receipt.methodWritten ?? "", l.channel, l.guestStatus, l.moneywiseEntry ?? "NOT FOUND",
    ]),
  ]);
  receiptsWs["!cols"] = [12, 11, 28, 8, 7, 11, 18, 11, 26, 22].map((wch) => ({ wch }));

  const mwWs = XLSX.utils.aoa_to_sheet([
    ["Id", "Date", "In/out", "Amount", "Counted as revenue", "Category", "Wallet", "Reference", "Description", "Matched receipt"],
    ...r.moneywise.map((m) => [m.id, m.date ?? "", m.direction, m.amount, yesNo(m.isRevenue), m.category ?? "", m.wallet ?? "", m.reference ?? "", m.description, m.matchedReceipt ?? ""]),
  ]);
  mwWs["!cols"] = [22, 11, 7, 11, 9, 18, 16, 16, 40, 20].map((wch) => ({ wch }));

  const masterWs = XLSX.utils.aoa_to_sheet([
    [`Master guest register to ${r.date} — every stay on every register, with what has been paid`],
    [],
    ["Guest", "Room", "Register date", "Check-in", "Check-out", "Nights", "Nights paid", "Amount paid", "Receipts", "Status", "In house on " + r.date],
    ...[...master].reverse().map((m) => [
      m.guestName, m.room ?? "", m.registerDate, m.checkIn ?? "", m.checkOut ?? "", m.nights ?? "", m.receiptedNights, m.amountPaid, m.receiptNumbers, m.status, m.inHouse ? "Yes" : "",
    ]),
  ]);
  masterWs["!cols"] = [28, 8, 12, 11, 11, 7, 9, 11, 20, 10, 12].map((wch) => ({ wch }));

  const inHouse = master.filter((m) => m.inHouse);
  const summary: Record<string, string | number | null> = {
    date: r.date,
    score: r.score,
    checksFailed: failed,
    checkIns: t.checkIns,
    guestsReceipted: t.guestsReceipted,
    unreceiptedGuests: t.unreceiptedGuests,
    receiptCount: t.receiptCount,
    receiptsWithoutGuest: t.receiptsWithoutGuest,
    nightsMismatches: t.nightsMismatches,
    roomNightsSold: t.roomNightsSold,
    totalReceipted: t.totalReceipted,
    cashReceipted: t.byChannel.cash,
    mobileReceipted: t.byChannel.mobile,
    moneywiseReceipted: t.byChannel.moneywise,
    otherReceipted: t.byChannel.other,
    cashDeposited: t.cashDeposited,
    mobileDeposited: t.mobileDeposited,
    totalDeposited: t.totalDeposited,
    mwRevenue: t.mwRevenue,
    mwInflows: t.mwInflows,
    receiptsNotInMoneyWise: t.receiptsNotInMoneyWise,
    guestsInHouse: inHouse.length,
    inHouseUnpaid: inHouse.filter((m) => m.status !== "Paid").length,
    checksJson: JSON.stringify(r.checks),
  };
  const summaryWs = XLSX.utils.aoa_to_sheet(Object.entries(summary).map(([k, val]) => [k, val]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, checksWs, "Checks");
  XLSX.utils.book_append_sheet(wb, guestsWs, "Guests vs Receipts");
  XLSX.utils.book_append_sheet(wb, receiptsWs, "Receipts");
  XLSX.utils.book_append_sheet(wb, mwWs, "MoneyWise");
  XLSX.utils.book_append_sheet(wb, masterWs, "Master Register");
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

// ── Running a day ────────────────────────────────────────────────────────────

type Outcome = { status: "success" | "skipped" | "failed"; message: string; submissionId?: Id<"submissions"> };

async function reconcileDate(ctx: ActionCtx, automationId: Id<"automations">, date: string): Promise<Outcome> {
  const day = await ctx.runQuery(internal.mew3.loadDay, { automationId, date });
  if (!day) return { status: "failed", message: "Automation is missing its output report." };
  if (!day.adminUserId) return { status: "failed", message: "No admin found to submit the report as." };

  const today = (xs: Array<{ date: string; rows: string }>) => xs.find((x) => x.date === date);
  const missing = (["guestRegister", "receipts", "deposits"] as const).filter((k) =>
    !today(k === "guestRegister" ? day.guestRegisters : k === "receipts" ? day.receipts : day.deposits),
  );
  if (missing.length) {
    return {
      status: "skipped",
      message: `${date}: waiting for ${missing.map((k) => LABELS[k].toLowerCase()).join(", ")} — not submitted yet, or submitted but not read (check its validation).`,
    };
  }

  const earlierGuests: DatedGuest[] = day.guestRegisters
    .filter((x) => x.date < date)
    .flatMap((x) => (JSON.parse(x.rows) as GuestStay[]).map((g) => ({ ...g, registerDate: x.date })));
  const earlierReceipts: DatedReceipt[] = day.receipts
    .filter((x) => x.date < date)
    .flatMap((x) => (JSON.parse(x.rows) as Receipt[]).map((r) => ({ ...r, reportDate: x.date })));

  let moneywise: DayInput["moneywise"];
  let mwNote: string;
  try {
    const raw = await ctx.runAction(internal.moneywise.fetchDayTransactions, { orgId: day.orgId, date });
    const all = raw.map(normalizeMwTxn).filter((t): t is MwTxn => !!t);
    const txns = all.filter((t) => t.date === date);
    moneywise = { ok: true, txns };
    mwNote = `MoneyWise: ${txns.length} transactions dated ${date} (Lusaka time), read from ${raw.length} returned for ${addDays(date, -1)} to ${addDays(date, 1)}.`;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    moneywise = { ok: false, reason: /not connected|No active|reconnect|missing/i.test(why) ? "MoneyWise is not connected for this organization." : `MoneyWise could not be read (${why.slice(0, 200)}).` };
    mwNote = `MoneyWise not checked: ${moneywise.reason}`;
  }

  const guests = JSON.parse(today(day.guestRegisters)!.rows) as GuestStay[];
  const receipts = JSON.parse(today(day.receipts)!.rows) as Receipt[];
  const deposits = JSON.parse(today(day.deposits)!.rows) as Deposit[];
  const result = reconcileDay({ date, guests, receipts, deposits, moneywise, earlierGuests, earlierReceipts });
  const master = buildMasterRegister(
    date,
    [...earlierGuests, ...guests.map((g) => ({ ...g, registerDate: date }))],
    [...earlierReceipts, ...receipts.map((r) => ({ ...r, reportDate: date }))],
  );

  const buffer = buildWorkbook(result, master, mwNote);
  const storageId = await ctx.storage.store(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
  );
  const period = periodContaining(day.output, Date.parse(`${date}T12:00:00Z`));
  const submissionId = await ctx.runMutation(internal.submissions.autoSubmitInternal, {
    templateId: day.output._id,
    userId: day.adminUserId,
    storageId,
    fileName: `mew3-reconciliation-${date}.xlsx`,
    fileLabel: "Reconciliation Workbook",
    periodLabel: period.periodLabel,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    // Re-checks run up to two days later for late MoneyWise entries; that is the system working, not lateness.
    dueAt: period.periodEnd + 3 * DAY_MS,
  });

  const failed = result.checks.filter((c) => c.status === "fail");
  return {
    status: "success",
    submissionId,
    message:
      `${date}: ${result.score}% — ${result.totals.checkIns} check-ins, ${result.totals.receiptCount} receipts, ${kwacha(result.totals.totalReceipted)} collected.` +
      (failed.length ? ` Failed: ${failed.map((c) => c.title.toLowerCase()).join("; ")}.` : " Everything matches."),
  };
}

async function runDates(
  ctx: ActionCtx,
  automationId: Id<"automations">,
  trigger: "schedule" | "manual" | "submission",
  dates: string[],
) {
  const runId = await ctx.runMutation(internal.canteenAutomation.startRun, { automationId, trigger });
  const done: string[] = [];
  const ids: Id<"submissions">[] = [];
  const messages: string[] = [];
  let anyFailed = false;
  for (const date of dates) {
    try {
      const out = await reconcileDate(ctx, automationId, date);
      messages.push(out.message);
      if (out.status === "failed") anyFailed = true;
      if (out.submissionId) {
        done.push(date);
        ids.push(out.submissionId);
      }
    } catch (err) {
      console.error(`[mew3Recon] ${date} failed`, err);
      anyFailed = true;
      messages.push(`${date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await ctx.runMutation(internal.canteenAutomation.finishRun, {
    runId,
    status: anyFailed ? "failed" : done.length ? "success" : "skipped",
    message: messages.join(" ") || "No dates to reconcile.",
    datesProcessed: done,
    submissionIds: ids,
  });
}

// ── Entry points ─────────────────────────────────────────────────────────────

/** A guest register, receipts or proof of deposit for `date` has just been submitted and read. */
export const runOnDocumentSubmitted = internalAction({
  args: { orgId: v.id("organizations"), date: v.string() },
  handler: async (ctx, { orgId, date }) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    for (const a of await ctx.runQuery(internal.mew3.listEnabled, { orgId })) {
      await runDates(ctx, a._id, "submission", [date]);
    }
    // Receipts become draft MoneyWise sales, waiting for Finance's approval.
    await ctx.runAction(internal.mew3Sales.prepareDay, { orgId, date }).catch(() => undefined);
  },
});

/** "Run now" from the automations page: every day in the last week that has all three documents. */
export const runAutomation = internalAction({
  args: { automationId: v.id("automations"), trigger: v.union(v.literal("schedule"), v.literal("manual")) },
  handler: async (ctx, { automationId, trigger }) => {
    const all = await ctx.runQuery(internal.mew3.listEnabled, {});
    const a = all.find((x) => x._id === automationId);
    if (!a) return;
    const dates = await ctx.runQuery(internal.mew3.completeDates, { orgId: a.orgId, days: 7 });
    await runDates(ctx, automationId, trigger, dates);
  },
});

/** Morning re-check of the two previous days, so revenue entered in MoneyWise late is picked up. */
export const runAllScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    const today = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
    for (const a of await ctx.runQuery(internal.mew3.listEnabled, {})) {
      await runDates(ctx, a._id, "schedule", [addDays(today, -2), addDays(today, -1)]);
    }
  },
});
