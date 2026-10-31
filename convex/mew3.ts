import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { addDays } from "./lib/mew3/recon";

/**
 * MEW3 Apartments — Finance's daily reports and the reconciliation that
 * checks them against each other and MoneyWise. This file holds the setup
 * and database side; the automation itself is in mew3Recon.ts and the rules
 * in lib/mew3/.
 */

export const KIND = "mew3DailyRecon";

const DOC_REPORTS = [
  {
    validatorKey: "mew3GuestRegister",
    name: "Daily Guest Register",
    fileLabel: "Guest Register",
    metricKey: "checkIns",
    metricLabel: "Check-ins",
  },
  {
    validatorKey: "mew3Receipts",
    name: "Daily Receipts",
    fileLabel: "Receipts",
    metricKey: "totalReceived",
    metricLabel: "Total receipted (K)",
  },
  {
    validatorKey: "mew3Deposits",
    name: "Daily Proof of Deposit",
    fileLabel: "Proof of Deposit",
    metricKey: "totalDeposited",
    metricLabel: "Total deposited (K)",
  },
] as const;

const OUTPUT_NAME = "Daily Reconciliation";

async function ensureTemplate(
  ctx: MutationCtx,
  departmentId: Id<"departments">,
  existing: Doc<"reportTemplates">[],
  spec: { validatorKey: string; name: string; fileLabel: string; fileTypes: Array<"pdf" | "jpg" | "png" | "xlsx">; allowMultiple?: boolean; metricKey: string; metricLabel: string },
): Promise<{ id: Id<"reportTemplates">; created: boolean }> {
  const found = existing.find((t) => t.validatorKey === spec.validatorKey);
  if (found) {
    // Templates set up before multi-file slots existed pick the setting up on the next run.
    if (spec.allowMultiple && found.requiredFiles.some((f) => !f.allowMultiple)) {
      await ctx.db.patch(found._id, { requiredFiles: found.requiredFiles.map((f) => ({ ...f, allowMultiple: true })) });
    }
    return { id: found._id, created: false };
  }
  const id = await ctx.db.insert("reportTemplates", {
    departmentId,
    name: spec.name,
    cadence: "daily",
    validatorKey: spec.validatorKey,
    weight: 1,
    // One register, one receipt bundle and one deposit proof per day, however many people can file it.
    sharingMode: "shared",
    requiredFiles: [{ label: spec.fileLabel, fileTypes: spec.fileTypes, required: true, ...(spec.allowMultiple ? { allowMultiple: true } : {}) }],
    validationRules: [],
    outcomeBenchmark: { metricKey: spec.metricKey, metricLabel: spec.metricLabel, showBenchmarkOnChart: false },
  });
  return { id, created: true };
}

/**
 * Sets up MEW3 Apartments: a Finance department with the three daily
 * document reports, the Daily Reconciliation report and the automation that
 * fills it. Idempotent — run again and it only adds what is missing.
 *
 *   npx convex run mew3:setupMew3Finance '{}'
 */
export const setupMew3Finance = internalMutation({
  args: { orgName: v.optional(v.string()) },
  handler: async (ctx, { orgName }) => {
    const orgs = await ctx.db.query("organizations").collect();
    const wanted = orgName?.toLowerCase().trim();
    const org = orgs.find((o) => (wanted ? o.name.toLowerCase().trim() === wanted : /mew\s*3/i.test(o.name)));
    if (!org) throw new Error(`No organization ${orgName ? `named "${orgName}"` : "matching MEW3"} — orgs are: ${orgs.map((o) => o.name).join(", ")}`);

    const created: string[] = [];
    const depts = await ctx.db.query("departments").withIndex("by_orgId", (q) => q.eq("orgId", org._id)).collect();
    let departmentId = depts.find((d) => d.name.toLowerCase().includes("finance"))?._id;
    if (!departmentId) {
      departmentId = await ctx.db.insert("departments", { orgId: org._id, name: "Finance", slug: "finance" });
      created.push("department: Finance");
    }

    const existing = await ctx.db.query("reportTemplates").withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId)).collect();
    for (const r of DOC_REPORTS) {
      const t = await ensureTemplate(ctx, departmentId, existing, { ...r, fileTypes: ["pdf", "jpg", "png"], allowMultiple: true });
      if (t.created) created.push(`report: ${r.name}`);
    }
    const output = await ensureTemplate(ctx, departmentId, existing, {
      validatorKey: KIND,
      name: OUTPUT_NAME,
      fileLabel: "Reconciliation Workbook",
      fileTypes: ["xlsx"],
      metricKey: "score",
      metricLabel: "Checks passed (%)",
    });
    if (output.created) created.push(`report: ${OUTPUT_NAME}`);

    const automation = await ctx.db
      .query("automations")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .filter((q) => q.eq(q.field("kind"), KIND))
      .first();
    if (!automation) {
      await ctx.db.insert("automations", {
        orgId: org._id,
        kind: KIND,
        name: "Daily Guest, Receipt & MoneyWise Reconciliation",
        description:
          "Once a day's guest register, receipts and proof of deposit are all submitted, checks that every check-in was receipted for the right number of nights, every receipt is booked as revenue in MoneyWise, cash and mobile money were deposited, and MoneyWise's inflows match what was collected. Submits a reconciliation workbook with a running master guest register. Re-checks the previous two days each morning to pick up late MoneyWise entries.",
        schedule: "When all three daily documents are in · re-check daily at 06:00 Lusaka",
        enabled: true,
        outputTemplateId: output.id,
      });
      created.push("automation: Daily Reconciliation");
    } else if (automation.outputTemplateId !== output.id) {
      await ctx.db.patch(automation._id, { outputTemplateId: output.id });
    }

    return { org: org.name, created };
  },
});

// ── Extracted rows ───────────────────────────────────────────────────────────

/** Saves what a validator read from a submission, replacing any earlier reading of it. */
export const saveExtractedRecords = internalMutation({
  args: {
    orgId: v.id("organizations"),
    submissionId: v.id("submissions"),
    kind: v.string(),
    date: v.string(),
    rows: v.string(),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db.query("extractedRecords").withIndex("by_submissionId", (q) => q.eq("submissionId", args.submissionId)).collect();
    for (const r of old) await ctx.db.delete(r._id);
    await ctx.db.insert("extractedRecords", { ...args, extractedAt: Date.now() });
  },
});

/** How far back stays and receipts are looked up for multi-day stays and the master register. */
const HISTORY_DAYS = 90;

/** Everything the reconciliation needs for one day. */
export const loadDay = internalQuery({
  args: { automationId: v.id("automations"), date: v.string() },
  handler: async (ctx, { automationId, date }) => {
    const automation = await ctx.db.get(automationId);
    if (!automation?.outputTemplateId) return null;
    const output = await ctx.db.get(automation.outputTemplateId);
    if (!output) return null;
    const orgId = automation.orgId;

    // Latest reading per day; a re-submitted document replaces the earlier one.
    const read = async (kind: string, from: string) => {
      const rows = await ctx.db
        .query("extractedRecords")
        .withIndex("by_orgId_kind_date", (q) => q.eq("orgId", orgId).eq("kind", kind).gte("date", from).lte("date", date))
        .collect();
      const latest = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if ((latest.get(r.date)?.extractedAt ?? 0) < r.extractedAt) latest.set(r.date, r);
      return [...latest.values()].map((r) => ({ date: r.date, rows: r.rows }));
    };
    const since = addDays(date, -HISTORY_DAYS);

    const admin = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();

    return {
      orgId,
      output,
      adminUserId: admin?.userId ?? null,
      guestRegisters: await read("guestRegister", since),
      receipts: await read("receipts", since),
      deposits: await read("deposits", date),
    };
  },
});

/** Dates in the last `days` days that have all three documents read — what a manual run reconciles. */
export const completeDates = internalQuery({
  args: { orgId: v.id("organizations"), days: v.number() },
  handler: async (ctx, { orgId, days }) => {
    const today = new Date().toISOString().slice(0, 10);
    const from = addDays(today, -days);
    const datesOf = async (kind: string) =>
      new Set(
        (
          await ctx.db
            .query("extractedRecords")
            .withIndex("by_orgId_kind_date", (q) => q.eq("orgId", orgId).eq("kind", kind).gte("date", from))
            .collect()
        ).map((r) => r.date),
      );
    const [g, r, d] = await Promise.all([datesOf("guestRegister"), datesOf("receipts"), datesOf("deposits")]);
    return [...g].filter((x) => r.has(x) && d.has(x)).sort();
  },
});

export const listEnabled = internalQuery({
  args: { orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, { orgId }) => {
    const all = orgId
      ? await ctx.db.query("automations").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect()
      : await ctx.db.query("automations").collect();
    return all.filter((a) => a.enabled && a.kind === KIND).map((a) => ({ _id: a._id, orgId: a.orgId }));
  },
});
