import * as XLSX from "xlsx";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { periodContaining } from "./lib/periods";
import { scanCanteenRecon, RATE_PER_DAY } from "./lib/parsers/canteenRecon";
import { buildChildren, datesToReport, justExpiredOn, reportDay, validOn } from "./lib/canteenValidity";
import type { Child, Payment, ValidChild } from "./lib/canteenValidity";

/**
 * Canteen valid-children automation.
 *
 * Each Canteen Sales Recon lists the children who paid and how much. This
 * replays every recon into a per-child ledger of paid school days and, for each
 * day with a recon, submits an Excel report of the children entitled to eat
 * that day and how many days each has left.
 *
 * It runs whenever someone submits (or replaces) a Canteen Daily Sales Report,
 * once the file has been validated, and can also be run by hand. A day is only
 * rebuilt when it has no report yet or a recon dated on or before it has been
 * submitted since — so reruns are safe, the first run backfills every past day,
 * and a corrected recon refreshes the days that depend on it.
 *
 * Payments are dated by the recon's report period (see reportDay); that day
 * counts as the first day paid for. Top-ups queue after the days a child
 * already has. The rules live in lib/canteenValidity.ts.
 */

export const KIND = "canteenValidChildren";
const OUTPUT_NAME = "Canteen Valid Children Report";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ── Setup ────────────────────────────────────────────────────────────────────

/** Creates the automation row and its output report for every org running canteen sales recon. Idempotent. */
export const seedCanteenValidChildren = internalMutation({
  args: {},
  handler: async (ctx) => {
    const created: string[] = [];
    const orgs = await ctx.db.query("organizations").collect();
    for (const org of orgs) {
      const depts = await ctx.db
        .query("departments")
        .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
        .collect();
      const templates = (
        await Promise.all(
          depts.map((d) =>
            ctx.db
              .query("reportTemplates")
              .withIndex("by_departmentId", (q) => q.eq("departmentId", d._id))
              .collect(),
          ),
        )
      ).flat();
      const sales = templates.find((t) => t.validatorKey === "canteenSalesRecon");
      if (!sales) continue;

      let outputId = templates.find((t) => t.validatorKey === KIND)?._id;
      if (!outputId) {
        outputId = await ctx.db.insert("reportTemplates", {
          departmentId: sales.departmentId,
          name: OUTPUT_NAME,
          cadence: "daily",
          validatorKey: KIND,
          weight: 1,
          sharingMode: "shared",
          excludedDaysOfWeek: [0, 5, 6],
          requiredFiles: [{ label: "Valid Children List", fileTypes: ["xlsx"], required: true }],
          validationRules: [],
          outcomeBenchmark: {
            metricKey: "validChildren",
            metricLabel: "Children valid to eat",
            showBenchmarkOnChart: false,
          },
        });
      }

      const existing = await ctx.db
        .query("automations")
        .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
        .filter((q) => q.eq(q.field("kind"), KIND))
        .first();
      if (!existing) {
        await ctx.db.insert("automations", {
          orgId: org._id,
          kind: KIND,
          name: "Canteen Valid Children",
          description:
            "Whenever a Canteen Daily Sales Report is submitted, replays every recon into a per-child ledger of paid school days and submits a daily Excel list of the children valid to eat that day and how many days each has left before expiry. Backfills past days on its first run.",
          schedule: "When a Canteen Daily Sales Report is submitted",
          enabled: true,
          outputTemplateId: outputId,
        });
        created.push(org.name);
      } else if (!existing.outputTemplateId) {
        await ctx.db.patch(existing._id, { outputTemplateId: outputId });
      }
    }
    return { created };
  },
});

// ── Inputs ───────────────────────────────────────────────────────────────────

export const loadInputs = internalQuery({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const automation = await ctx.db.get(automationId);
    if (!automation || !automation.outputTemplateId) return null;
    const output = await ctx.db.get(automation.outputTemplateId);
    if (!output) return null;

    const depts = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", automation.orgId))
      .collect();
    const templates = (
      await Promise.all(
        depts.map((d) =>
          ctx.db
            .query("reportTemplates")
            .withIndex("by_departmentId", (q) => q.eq("departmentId", d._id))
            .collect(),
        ),
      )
    ).flat();
    const salesTemplate = templates.find((t) => t.validatorKey === "canteenSalesRecon");

    const submittedIn = async (templateId: Id<"reportTemplates">) =>
      (
        await ctx.db
          .query("submissions")
          .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
          .collect()
      ).filter((s) => s.submittedAt !== undefined);

    const recons: Array<{ periodLabel: string; submittedAt: number; storageId: Id<"_storage"> }> = [];
    if (salesTemplate) {
      for (const s of await submittedIn(salesTemplate._id)) {
        const files = await ctx.db
          .query("submissionFiles")
          .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
          .collect();
        // The sales recon is the file the recon parser recognised (it carries the tier counts).
        const f = files.find((x) => x.extracted?.metadata?.salesCountDaily !== undefined);
        if (f) recons.push({ periodLabel: s.periodLabel, submittedAt: s.submittedAt ?? 0, storageId: f.storageId });
      }
    }

    const reported = (await submittedIn(output._id)).map((s) => ({
      periodLabel: s.periodLabel,
      submittedAt: s.submittedAt ?? 0,
    }));
    const admin = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", automation.orgId))
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();

    return { output, recons, reported, adminUserId: admin?.userId ?? null };
  },
});

// ── Workbook ─────────────────────────────────────────────────────────────────

const money = (n: number) => `K${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function flagsFor(c: ValidChild): string {
  const out: string[] = [];
  if (c.paidToday?.rounded) out.push(`Paid ${money(c.paidToday.amount)} — rounded to ${c.paidToday.days} day${c.paidToday.days === 1 ? "" : "s"}`);
  else if (c.lastPayment.rounded) out.push(`Last payment ${money(c.lastPayment.amount)} was rounded to ${c.lastPayment.days} day${c.lastPayment.days === 1 ? "" : "s"}`);
  if (c.aliases.length) out.push(`Also written as: ${c.aliases.join(", ")}`);
  out.push(...c.notes);
  return out.join(" · ");
}

export function buildWorkbook(children: Child[], date: string) {
  const valid = validOn(children, date);
  const expired = justExpiredOn(children, date);
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

  const paidToday = valid.filter((c) => c.paidToday).length;
  const lastDay = valid.filter((c) => c.daysAfter === 0).length;
  const nextDay = valid.filter((c) => c.daysAfter === 1).length;
  const rounded = valid.filter((c) => c.paidToday?.rounded).length;
  const flagged = valid.filter((c) => flagsFor(c)).length;

  const header = [
    "No.",
    "Child",
    "Class",
    "Status",
    "Days left after today",
    "Days left incl. today",
    "Last valid day",
    "Paid today (days)",
    "Paid today (K)",
    "Last payment date",
    "Last payment (days)",
    "Flags",
  ];
  const rows = valid.map((c, i) => [
    i + 1,
    c.name,
    c.className,
    c.paidToday ? "Paid today" : c.daysAfter === 0 ? "Last day" : "Active",
    c.daysAfter,
    c.daysAfter + 1,
    c.lastValidDay,
    c.paidToday?.days ?? "",
    c.paidToday?.amount ?? "",
    c.lastPayment.date,
    c.lastPayment.days,
    flagsFor(c),
  ]);
  const listWs = XLSX.utils.aoa_to_sheet([
    [`Canteen children valid on ${weekday} ${date}`],
    [`${valid.length} valid · ${lastDay} on their last day · ${nextDay} with one more day after today · ${paidToday} paid today`],
    [],
    header,
    ...rows,
  ]);
  listWs["!cols"] = [5, 30, 10, 11, 12, 12, 14, 12, 12, 16, 13, 60].map((wch) => ({ wch }));

  const expiredWs = XLSX.utils.aoa_to_sheet([
    ["Child", "Class", "Last valid day", "Last paid on"],
    ...expired.map((c) => [c.name, c.className, c.lastValidDay, c.lastPaidOn]),
  ]);
  expiredWs["!cols"] = [30, 10, 14, 14].map((wch) => ({ wch }));

  const flagRows = valid.filter((c) => flagsFor(c)).map((c) => [c.name, c.className, flagsFor(c)]);
  const flagsWs = XLSX.utils.aoa_to_sheet([["Child", "Class", "Flag"], ...flagRows]);
  flagsWs["!cols"] = [30, 10, 90].map((wch) => ({ wch }));

  const summary: Record<string, number | string> = {
    date,
    validChildren: valid.length,
    expiringToday: lastDay,
    expiringNextDay: nextDay,
    paidToday,
    justExpired: expired.length,
    roundedPayments: rounded,
    flaggedChildren: flagged,
    ratePerDay: RATE_PER_DAY,
  };
  const summaryWs = XLSX.utils.aoa_to_sheet(Object.entries(summary).map(([k, val]) => [k, val]));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, listWs, "Valid Children");
  XLSX.utils.book_append_sheet(wb, expiredWs, "Just Expired");
  XLSX.utils.book_append_sheet(wb, flagsWs, "Flags");
  XLSX.utils.book_append_sheet(wb, summaryWs, "Summary");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { buffer, summary };
}

// ── Entry points ─────────────────────────────────────────────────────────────

async function runOne(
  ctx: ActionCtx,
  automationId: Id<"automations">,
  trigger: "schedule" | "manual" | "submission",
  rebuild = false,
) {
  // The run log is shared with the other canteen automation.
  const runId = await ctx.runMutation(internal.canteenAutomation.startRun, { automationId, trigger });
  const finish = (
    status: "success" | "skipped" | "failed",
    message: string,
    datesProcessed: string[] = [],
    submissionIds: Id<"submissions">[] = [],
  ) => ctx.runMutation(internal.canteenAutomation.finishRun, { runId, status, message, datesProcessed, submissionIds });

  try {
    const input = await ctx.runQuery(internal.canteenValidChildren.loadInputs, { automationId });
    if (!input) return await finish("failed", "Automation is missing its output report.");
    if (!input.adminUserId) return await finish("failed", "No admin found to submit reports as.");
    if (input.recons.length === 0) return await finish("skipped", "No Canteen Sales Recon submissions found.");

    // Read every recon. Where two are dated the same day the latest submission wins.
    const byDate = new Map<string, { submittedAt: number; payments: Payment[] }>();
    const problems: string[] = [];
    const differing: string[] = [];
    const clashes: string[] = [];
    for (const r of input.recons) {
      try {
        const blob = await ctx.storage.get(r.storageId);
        if (!blob) throw new Error("file missing from storage");
        const { statement, payments } = scanCanteenRecon(await blob.arrayBuffer());
        // The report period says which day this recon is for (Monday's sits under Friday). The date
        // written inside the file is only a cross-check — staff sometimes upload the wrong sheet.
        const date = reportDay(r.periodLabel);
        const fileDate = statement.metadata?.date;
        if (typeof fileDate === "string" && fileDate !== date) differing.push(`${date} (file says ${fileDate})`);
        const prev = byDate.get(date);
        if (prev) clashes.push(date);
        if (prev && prev.submittedAt > r.submittedAt) continue;
        byDate.set(date, {
          submittedAt: r.submittedAt,
          payments: payments.map((p) => ({ date, name: p.name, className: p.className, amount: p.amount })),
        });
      } catch (err) {
        problems.push(`${r.periodLabel}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const reportedAt = new Map<string, number>();
    for (const r of input.reported) reportedAt.set(r.periodLabel, Math.max(reportedAt.get(r.periodLabel) ?? 0, r.submittedAt));
    const reconAt = new Map([...byDate].map(([d, v]) => [d, v.submittedAt]));
    // `rebuild` regenerates every day, e.g. after a fix to how recons are dated.
    const todo = rebuild ? datesToReport(reconAt, new Map()) : datesToReport(reconAt, reportedAt);

    const sample = (xs: string[]) => xs.sort().slice(0, 4).join(", ") + (xs.length > 4 ? ", …" : "");
    const notes =
      (clashes.length ? ` More than one recon is filed for ${sample([...new Set(clashes)])}; the latest was used.` : "") +
      (differing.length ? ` The date inside the recon file differs from its report period for ${differing.length}: ${sample(differing)}.` : "") +
      (problems.length ? ` Could not read: ${problems.join("; ")}.` : "");

    if (todo.length === 0) return await finish("skipped", `Nothing new to report.${notes}`);

    const children = buildChildren([...byDate.values()].flatMap((d) => d.payments));

    const done: string[] = [];
    const ids: Id<"submissions">[] = [];
    const counts: string[] = [];
    for (const target of todo) {
      const { buffer, summary } = buildWorkbook(children, target);
      const storageId = await ctx.storage.store(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const period = periodContaining(input.output, Date.parse(`${target}T12:00:00Z`));
      const id = await ctx.runMutation(internal.submissions.autoSubmitInternal, {
        templateId: input.output._id,
        userId: input.adminUserId,
        storageId,
        fileName: `canteen-valid-children-${target}.xlsx`,
        fileLabel: "Valid Children List",
        periodLabel: period.periodLabel,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueAt: period.dueAt,
      });
      done.push(target);
      ids.push(id);
      counts.push(`${target}: ${summary.validChildren}`);
    }
    return await finish(
      "success",
      `Submitted ${done.length} report${done.length === 1 ? "" : "s"} (children valid) — ${counts.join(", ")}.${notes}`,
      done,
      ids,
    );
  } catch (err) {
    console.error("[canteenValidChildren] failed", err);
    await finish("failed", err instanceof Error ? err.message : String(err));
  }
}

export const runAutomation = internalAction({
  args: {
    automationId: v.id("automations"),
    trigger: v.union(v.literal("schedule"), v.literal("manual")),
    /** Regenerate every day's report, not just new or out-of-date ones. */
    rebuild: v.optional(v.boolean()),
  },
  handler: async (ctx, { automationId, trigger, rebuild }) => {
    await runOne(ctx, automationId, trigger, rebuild);
  },
});

export const listEnabledForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) =>
    (await ctx.db.query("automations").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect())
      .filter((a) => a.enabled && a.kind === KIND)
      .map((a) => a._id),
});

/** Runs when a Canteen Daily Sales Report has been submitted and validated. */
export const runOnReconSubmitted = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    for (const id of await ctx.runQuery(internal.canteenValidChildren.listEnabledForOrg, { orgId })) {
      await runOne(ctx, id, "submission");
    }
  },
});
