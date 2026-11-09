import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, QueryCtx } from "./_generated/server";
import { requireProfile } from "./lib/roles";
import { normalizeMwTxn } from "./lib/mew3/moneywise";
import { findInMoneyWise, planSales, saleRequest, type PlannedSale, type SaleLedger } from "./lib/mew3/sales";
import type { GuestStay, MwTxn, Receipt } from "./lib/mew3/types";

/**
 * MEW3 receipts → MoneyWise sales, with Finance's approval in between.
 *
 *  1. Whenever a day's receipts or register are read or corrected, `prepareDay`
 *     drafts one sale per receipt, marking those already entered in MoneyWise by hand.
 *  2. On the receipts submission, a manager or admin picks the ledger where the
 *     receipt doesn't say (Cash / Airtel Money / Bank) and approves the day.
 *  3. `postApproved` checks MoneyWise once more and posts what is still missing.
 */

const ledger = v.union(v.literal("CASH"), v.literal("AIRTEL_MONEY"), v.literal("BANK"));
const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

async function latestRows<T>(ctx: QueryCtx, orgId: Id<"organizations">, kind: string, date: string): Promise<T[]> {
  const rows = await ctx.db
    .query("extractedRecords")
    .withIndex("by_orgId_kind_date", (q) => q.eq("orgId", orgId).eq("kind", kind).eq("date", date))
    .collect();
  const latest = rows.sort((a, b) => b.extractedAt - a.extractedAt)[0];
  return latest ? (JSON.parse(latest.rows) as T[]) : [];
}

export const dayInputs = internalQuery({
  args: { orgId: v.id("organizations"), date: v.string() },
  handler: async (ctx, { orgId, date }) => ({
    receipts: await latestRows<Receipt>(ctx, orgId, "receipts", date),
    guests: await latestRows<GuestStay>(ctx, orgId, "guestRegister", date),
  }),
});

/** The day's MoneyWise inflows, or null when MoneyWise could not be read. */
async function moneywiseDay(ctx: ActionCtx, orgId: Id<"organizations">, date: string): Promise<MwTxn[] | null> {
  try {
    const raw = await ctx.runAction(internal.moneywise.fetchDayTransactions, { orgId, date });
    // A sale entered by hand may be dated a day either side of the receipt.
    return raw.map(normalizeMwTxn).filter((t): t is MwTxn => !!t && t.direction === "in");
  } catch {
    return null;
  }
}

export const saveDrafts = internalMutation({
  args: { orgId: v.id("organizations"), date: v.string(), planned: v.string() },
  handler: async (ctx, { orgId, date, planned }) => {
    const plan = JSON.parse(planned) as PlannedSale[];
    const existing = await ctx.db.query("mew3Sales").withIndex("by_orgId_date", (q) => q.eq("orgId", orgId).eq("date", date)).collect();
    const byKey = new Map(existing.map((s) => [s.key, s]));
    const locked = (s: Doc<"mew3Sales">) => s.status === "posted" || s.status === "approved";

    for (const p of plan) {
      const fields = {
        receiptNumber: p.receiptNumber,
        guestName: p.guestName,
        phone: p.phone,
        room: p.room,
        checkIn: p.checkIn,
        checkOut: p.checkOut,
        amount: p.amount,
      };
      const old = byKey.get(p.key);
      if (!old) {
        await ctx.db.insert("mew3Sales", {
          orgId, date, key: p.key, ...fields, ledger: p.ledger,
          status: p.existingEntry ? "inMoneyWise" : "draft",
          ...(p.existingEntry ? { moneywiseRef: p.existingEntry } : {}),
        });
        continue;
      }
      if (locked(old)) continue;
      await ctx.db.patch(old._id, {
        ...fields,
        // A ledger Finance chose stands; otherwise follow the (possibly corrected) receipt.
        ledger: old.ledgerChosen ? old.ledger : p.ledger,
        status: p.existingEntry ? "inMoneyWise" : old.status === "skipped" ? "skipped" : "draft",
        moneywiseRef: p.existingEntry ?? undefined,
        error: undefined,
      });
    }
    // Receipts that are gone from a corrected reading drop out, unless already on their way.
    const keys = new Set(plan.map((p) => p.key));
    for (const s of existing) if (!keys.has(s.key) && !locked(s)) await ctx.db.delete(s._id);
  },
});

/** Drafts (or refreshes) the day's sales from its latest receipts and register. Never throws. */
export const prepareDay = internalAction({
  args: { orgId: v.id("organizations"), date: v.string() },
  handler: async (ctx, { orgId, date }) => {
    if (!isDay(date)) return;
    const { receipts, guests } = await ctx.runQuery(internal.mew3Sales.dayInputs, { orgId, date });
    const mw = (await moneywiseDay(ctx, orgId, date)) ?? [];
    const planned = planSales(date, receipts, guests, mw);
    await ctx.runMutation(internal.mew3Sales.saveDrafts, { orgId, date, planned: JSON.stringify(planned) });
  },
});

// ── Finance's view and approval ─────────────────────────────────────────────

async function dayOfSubmission(ctx: QueryCtx, submissionId: Id<"submissions">) {
  const rec = (await ctx.db.query("extractedRecords").withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId)).collect()).find(
    (r) => r.kind === "receipts",
  );
  return rec ? { orgId: rec.orgId, date: rec.date } : null;
}

/** The sales drafted from a receipts submission. Null when it is not a MEW3 receipts submission. */
export const forSubmission = query({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const profile = await requireProfile(ctx);
    const day = await dayOfSubmission(ctx, submissionId);
    if (!day || day.orgId !== profile.orgId) return null;
    const sales = await ctx.db.query("mew3Sales").withIndex("by_orgId_date", (q) => q.eq("orgId", day.orgId).eq("date", day.date)).collect();
    sales.sort((a, b) => (a.receiptNumber ?? a.guestName).localeCompare(b.receiptNumber ?? b.guestName));
    return { date: day.date, canApprove: profile.role === "admin" || profile.role === "manager", sales };
  },
});

async function editableSale(ctx: QueryCtx, saleId: Id<"mew3Sales">) {
  const profile = await requireProfile(ctx);
  if (profile.role !== "admin" && profile.role !== "manager") throw new Error("Only a manager or admin can approve sales for MoneyWise.");
  const sale = await ctx.db.get(saleId);
  if (!sale || sale.orgId !== profile.orgId) throw new Error("Sale not found");
  if (sale.status === "posted" || sale.status === "approved") throw new Error("This sale has already gone to MoneyWise.");
  return sale;
}

export const setLedger = mutation({
  args: { saleId: v.id("mew3Sales"), ledger },
  handler: async (ctx, { saleId, ledger }) => {
    await editableSale(ctx, saleId);
    await ctx.db.patch(saleId, { ledger, ledgerChosen: true });
  },
});

export const setSkipped = mutation({
  args: { saleId: v.id("mew3Sales"), skipped: v.boolean() },
  handler: async (ctx, { saleId, skipped }) => {
    const sale = await editableSale(ctx, saleId);
    if (sale.status === "inMoneyWise") throw new Error("This receipt is already in MoneyWise.");
    await ctx.db.patch(saleId, { status: skipped ? "skipped" : "draft" });
  },
});

/** Approves every ready sale of the day (and retries failed ones), then posts them. */
export const approveDay = mutation({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const profile = await requireProfile(ctx);
    if (profile.role !== "admin" && profile.role !== "manager") throw new Error("Only a manager or admin can approve sales for MoneyWise.");
    const day = await dayOfSubmission(ctx, submissionId);
    if (!day || day.orgId !== profile.orgId) throw new Error("No receipts have been read for this submission.");
    const sales = await ctx.db.query("mew3Sales").withIndex("by_orgId_date", (q) => q.eq("orgId", day.orgId).eq("date", day.date)).collect();
    const ready = sales.filter((s) => (s.status === "draft" || s.status === "failed") && s.ledger);
    const needLedger = sales.filter((s) => (s.status === "draft" || s.status === "failed") && !s.ledger).length;
    for (const s of ready) await ctx.db.patch(s._id, { status: "approved", approvedBy: profile.userId, approvedAt: Date.now(), error: undefined });
    if (ready.length) await ctx.scheduler.runAfter(0, internal.mew3Sales.postApproved, { orgId: day.orgId, date: day.date });
    return { approved: ready.length, needLedger };
  },
});

// ── Posting ──────────────────────────────────────────────────────────────────

export const approvedForDay = internalQuery({
  args: { orgId: v.id("organizations"), date: v.string() },
  handler: async (ctx, { orgId, date }) =>
    (await ctx.db.query("mew3Sales").withIndex("by_orgId_date", (q) => q.eq("orgId", orgId).eq("date", date)).collect()).filter(
      (s) => s.status === "approved",
    ),
});

export const markResult = internalMutation({
  args: {
    saleId: v.id("mew3Sales"),
    status: v.union(v.literal("posted"), v.literal("failed"), v.literal("inMoneyWise")),
    ref: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { saleId, status, ref, error }) => {
    await ctx.db.patch(saleId, {
      status,
      ...(ref ? { moneywiseRef: ref } : {}),
      error,
      ...(status === "posted" ? { postedAt: Date.now() } : {}),
    });
  },
});

export const postApproved = internalAction({
  args: { orgId: v.id("organizations"), date: v.string() },
  handler: async (ctx, { orgId, date }) => {
    const approved = await ctx.runQuery(internal.mew3Sales.approvedForDay, { orgId, date });
    if (!approved.length) return;

    // Someone may have entered a sale by hand since it was drafted; never book it twice.
    const mw = await moneywiseDay(ctx, orgId, date);
    if (mw === null) {
      for (const s of approved) {
        await ctx.runMutation(internal.mew3Sales.markResult, { saleId: s._id, status: "failed", error: "Couldn't read MoneyWise to check it isn't already entered. Approve again to retry." });
      }
      return;
    }
    // Our own earlier posts carry the key, so a retry after a lost response isn't mistaken for a hand entry.
    const handEntered = mw.filter((t) => !approved.some((s) => t.reference === s.key || t.description.includes(s.key)));
    const already = findInMoneyWise(approved, handEntered);

    for (const [i, s] of approved.entries()) {
      const hit = already[i];
      if (hit !== null) {
        const e = handEntered[hit];
        await ctx.runMutation(internal.mew3Sales.markResult, { saleId: s._id, status: "inMoneyWise", ref: e.reference ?? e.id });
        continue;
      }
      const body = saleRequest(date, { ...s, ledger: s.ledger as SaleLedger, existingEntry: null });
      const out = await ctx.runAction(internal.moneywise.postSale, { orgId, body: JSON.stringify(body) });
      await ctx.runMutation(
        internal.mew3Sales.markResult,
        out.ok ? { saleId: s._id, status: "posted", ref: out.ref } : { saleId: s._id, status: "failed", error: out.error },
      );
    }
  },
});
