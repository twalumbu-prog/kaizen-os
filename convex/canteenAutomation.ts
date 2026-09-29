import * as XLSX from "xlsx";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { periodContaining } from "./lib/periods";

/**
 * Canteen deviation automation.
 *
 * For every school day (Mon–Thu) with a Canteen Sales Recon submission it
 *  1. lays the per-tier subscription counts out by date,
 *  2. rolls the subscriptions forward (opening + additions − expired = balance)
 *     to work out how many children should be valid to eat that day,
 *  3. compares that with the children counted in the Canteen Inventory Stock
 *     Usage Report,
 *  4. submits the workbook as a report whose outcome metric is the deviation.
 * A date is only reported once its inventory report exists; dates already
 * reported are left alone, so the job is safe to run as often as you like.
 */

export const KIND = "canteenDeviation";
const OUTPUT_NAME = "Canteen Sales vs Inventory Deviation";
const INVENTORY_NAME = "Canteen Inventory";
const RATE = 35;
const DAY_MS = 86_400_000;

/** Weekdays the canteen operates (0 = Sunday). */
const SCHOOL_DAYS = [1, 2, 3, 4];

const TIERS: Array<{ label: string; key: string; expiry: number }> = [
  { label: "2D", key: "salesCount2Day", expiry: 2 },
  { label: "3D", key: "salesCount3Day", expiry: 3 },
  { label: "W", key: "salesCountWeekly", expiry: 4 },
  { label: "2W", key: "salesCount2Week", expiry: 8 },
  { label: "3W", key: "salesCount3Week", expiry: 12 },
  { label: "M", key: "salesCountMonthly", expiry: 16 },
];

const isSchoolDay = (iso: string) => SCHOOL_DAYS.includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

type Meta = Record<string, string | number | null>;

// ── Setup ────────────────────────────────────────────────────────────────────

/** Creates the automation row and its output report for every org running canteen sales recon. Idempotent. */
export const seedCanteenDeviation = internalMutation({
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

      let output = templates.find((t) => t.validatorKey === KIND);
      let outputId = output?._id;
      if (!outputId) {
        outputId = await ctx.db.insert("reportTemplates", {
          departmentId: sales.departmentId,
          name: OUTPUT_NAME,
          cadence: "daily",
          validatorKey: KIND,
          weight: 1,
          sharingMode: "shared",
          excludedDaysOfWeek: [0, 5, 6],
          requiredFiles: [{ label: "Deviation Report", fileTypes: ["xlsx"], required: true }],
          validationRules: [],
          outcomeBenchmark: {
            metricKey: "deviation",
            metricLabel: "Children deviation (Inventory − Expected)",
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
          name: "Canteen Sales vs Inventory Deviation",
          description:
            "Lays out the Canteen Sales Recon subscription counts by date, works out how many children should be valid to eat each day, compares that with the Canteen Inventory Stock Usage Report, and submits the Excel report with the deviation as its outcome.",
          schedule: "Daily at 17:00 UTC (Mon–Thu school days)",
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
    const inventoryTemplate = templates.find((t) => t.name.includes(INVENTORY_NAME));
    const inventoryKey = inventoryTemplate?.outcomeBenchmark?.metricKey ?? "numberOfChildren";

    const submittedIn = async (templateId: Id<"reportTemplates">) =>
      (
        await ctx.db
          .query("submissions")
          .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
          .collect()
      ).filter((s) => s.submittedAt !== undefined);

    const sales: Array<{ date: string; metadata: Meta }> = [];
    if (salesTemplate) {
      for (const s of await submittedIn(salesTemplate._id)) {
        const files = await ctx.db
          .query("submissionFiles")
          .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
          .collect();
        const f = files.find((x) => x.extracted?.metadata?.salesCountDaily !== undefined);
        if (f?.extracted?.metadata) sales.push({ date: s.periodLabel, metadata: f.extracted.metadata });
      }
    }

    const inventory: Record<string, number> = {};
    if (inventoryTemplate) {
      for (const s of await submittedIn(inventoryTemplate._id)) {
        const files = await ctx.db
          .query("submissionFiles")
          .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
          .collect();
        for (const f of files) {
          const val = f.extracted?.metadata?.[inventoryKey];
          if (typeof val === "number") inventory[s.periodLabel] = val;
        }
      }
    }

    const reported = (await submittedIn(output._id)).map((s) => s.periodLabel);
    const admin = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", automation.orgId))
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();

    return { output, sales, inventory, reported, adminUserId: admin?.userId ?? null };
  },
});

// ── Workbook ─────────────────────────────────────────────────────────────────

interface DayInput {
  date: string;
  meta: Meta | undefined;
}

function buildWorkbook(days: DayInput[], inventory: Record<string, number>, target: string) {
  const ws: XLSX.WorkSheet = {};
  const put = (addr: string, val: string | number, f?: string) => {
    ws[addr] = f ? { t: "n", v: val as number, f } : { t: typeof val === "number" ? "n" : "s", v: val };
  };
  const col = (i: number) => XLSX.utils.encode_col(i + 2); // day columns start at C

  const TE = 30, AT = 32, RC = 33, DF = 34, KI = 35, RD = 36, OT = 37;
  put("A1", "Canteen Sales vs Inventory Deviation");
  put("A2", "Day");
  put("A3", "Date");
  put("A4", "1D - Additions");
  TIERS.forEach((t, gi) => {
    const r = 5 + gi * 4;
    ["Opening balance", "Additions", "Expired", "Closing balance"].forEach((l, i) => put(`A${r + i}`, `${t.label} - ${l}`));
  });
  put(`A${TE}`, "Total Expected");
  put(`A${AT}`, "Actual Total (Inventory Stock Usage Report)");
  put(`A${RC}`, "Students per Canteen Sales Recon");
  put(`A${DF}`, "Difference");
  put(`A${KI}`, "Kwacha Impact");
  put(`A${RD}`, "Sales Recon minus Inventory Report");
  put(`A${OT}`, "Other / unmatched payments (not in any tier)");

  const WN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const state: Record<string, Array<{ add: number; close: number }>> = {};
  let summary: Record<string, number | string> = {};

  days.forEach((d, i) => {
    const c = col(i), p = col(i - 1);
    const m = d.meta;
    put(`${c}2`, WN[new Date(`${d.date}T00:00:00Z`).getUTCDay()]);
    put(`${c}3`, d.date);
    const daily = num(m?.salesCountDaily);
    put(`${c}4`, daily);
    let total = daily;
    TIERS.forEach((t, gi) => {
      const r = 5 + gi * 4;
      state[t.label] = state[t.label] ?? [];
      const open = i === 0 ? 0 : state[t.label][i - 1].close;
      const add = num(m?.[t.key]);
      const expired = i - t.expiry >= 0 ? state[t.label][i - t.expiry].add : 0;
      const close = open + add - expired;
      state[t.label][i] = { add, close };
      if (i === 0) put(`${c}${r}`, 0);
      else put(`${c}${r}`, open, `${p}${r + 3}`);
      put(`${c}${r + 1}`, add);
      if (i - t.expiry >= 0) put(`${c}${r + 2}`, expired, `${col(i - t.expiry)}${r + 1}`);
      else put(`${c}${r + 2}`, 0);
      put(`${c}${r + 3}`, close, `${c}${r}+${c}${r + 1}-${c}${r + 2}`);
      total += close;
    });
    put(`${c}${TE}`, total, `${c}4+${TIERS.map((_, gi) => `${c}${8 + gi * 4}`).join("+")}`);

    const actual = inventory[d.date];
    const recon = m ? num(m.studentCount) : undefined;
    if (recon !== undefined) {
      put(`${c}${RC}`, recon);
      put(`${c}${OT}`, num(m?.salesCountOther));
    }
    if (actual !== undefined) {
      put(`${c}${AT}`, actual);
      put(`${c}${DF}`, actual - total, `${c}${AT}-${c}${TE}`);
      put(`${c}${KI}`, (actual - total) * RATE, `${c}${DF}*${RATE}`);
      if (recon !== undefined) put(`${c}${RD}`, recon - actual, `${c}${RC}-${c}${AT}`);
    }
    if (d.date === target) {
      summary = {
        date: d.date,
        expectedChildren: total,
        ...(actual !== undefined ? { actualChildren: actual, deviation: actual - total, kwachaImpact: (actual - total) * RATE } : {}),
        ...(recon !== undefined ? { salesReconStudents: recon } : {}),
        ...(recon !== undefined && actual !== undefined ? { reconMinusInventory: recon - actual } : {}),
      };
    }
  });

  put("A39", "Day columns are Mon–Thu school days. Expiry (school days): 2D=2, 3D=3, W=4, 2W=8, 3W=12, M=16 (K35/day). Balances start at 0 on the first day.");
  ws["!ref"] = `A1:${col(days.length - 1)}39`;
  ws["!cols"] = [{ wch: 42 }, { wch: 3 }, ...days.map(() => ({ wch: 11 }))];

  const sum = XLSX.utils.aoa_to_sheet(Object.entries(summary).map(([k, val]) => [k, val]));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Deviation");
  XLSX.utils.book_append_sheet(wb, sum, "Summary");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return { buffer: out, summary };
}

// ── Run log ──────────────────────────────────────────────────────────────────

export const startRun = internalMutation({
  args: { automationId: v.id("automations"), trigger: v.union(v.literal("schedule"), v.literal("manual")) },
  handler: async (ctx, { automationId, trigger }) => {
    const a = await ctx.db.get(automationId);
    if (!a) throw new Error("Automation not found");
    return await ctx.db.insert("automationRuns", {
      automationId,
      orgId: a.orgId,
      startedAt: Date.now(),
      trigger,
      status: "running",
      message: "Running…",
      datesProcessed: [],
      submissionIds: [],
    });
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("automationRuns"),
    status: v.union(v.literal("success"), v.literal("skipped"), v.literal("failed")),
    message: v.string(),
    datesProcessed: v.array(v.string()),
    submissionIds: v.array(v.id("submissions")),
  },
  handler: async (ctx, { runId, ...rest }) => {
    await ctx.db.patch(runId, { ...rest, finishedAt: Date.now() });
  },
});

// ── Entry points ─────────────────────────────────────────────────────────────

async function runOne(ctx: ActionCtx, automationId: Id<"automations">, trigger: "schedule" | "manual") {
  const runId = await ctx.runMutation(internal.canteenAutomation.startRun, { automationId, trigger });
  const finish = (
    status: "success" | "skipped" | "failed",
    message: string,
    datesProcessed: string[] = [],
    submissionIds: Id<"submissions">[] = [],
  ) => ctx.runMutation(internal.canteenAutomation.finishRun, { runId, status, message, datesProcessed, submissionIds });

  try {
    const input = await ctx.runQuery(internal.canteenAutomation.loadInputs, { automationId });
    if (!input) return await finish("failed", "Automation is missing its output report.");
    if (!input.adminUserId) return await finish("failed", "No admin found to submit reports as.");

    const salesByDate = new Map<string, Meta>();
    for (const s of input.sales) if (isSchoolDay(s.date)) salesByDate.set(s.date, s.metadata);
    const salesDates = [...salesByDate.keys()].sort();
    if (salesDates.length === 0) return await finish("skipped", "No Canteen Sales Recon submissions found.");

    // Every school day from the first recon to the last, so gaps still expire correctly.
    const first = Date.parse(`${salesDates[0]}T00:00:00Z`);
    const last = Date.parse(`${salesDates[salesDates.length - 1]}T00:00:00Z`);
    const calendar: string[] = [];
    for (let t = first; t <= last; t += DAY_MS) {
      const iso = new Date(t).toISOString().slice(0, 10);
      if (isSchoolDay(iso)) calendar.push(iso);
    }

    const reported = new Set(input.reported);
    const waiting: string[] = [];
    const todo: string[] = [];
    for (const d of salesDates) {
      if (reported.has(d)) continue;
      if (input.inventory[d] === undefined) waiting.push(d);
      else todo.push(d);
    }
    if (todo.length === 0) {
      return await finish(
        "skipped",
        waiting.length
          ? `No new dates ready. Waiting for the Canteen Inventory Stock Usage Report for: ${waiting.join(", ")}.`
          : "No new dates since the last run.",
      );
    }

    const done: string[] = [];
    const ids: Id<"submissions">[] = [];
    const deviations: string[] = [];
    for (const target of todo) {
      const days = calendar.filter((d) => d <= target).map((d) => ({ date: d, meta: salesByDate.get(d) }));
      const { buffer, summary } = buildWorkbook(days, input.inventory, target);
      const storageId = await ctx.storage.store(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      );
      const period = periodContaining(input.output, Date.parse(`${target}T12:00:00Z`));
      const id = await ctx.runMutation(internal.submissions.autoSubmitInternal, {
        templateId: input.output._id,
        userId: input.adminUserId,
        storageId,
        fileName: `canteen-deviation-${target}.xlsx`,
        fileLabel: "Deviation Report",
        periodLabel: period.periodLabel,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        dueAt: period.dueAt,
      });
      done.push(target);
      ids.push(id);
      deviations.push(`${target}: ${typeof summary.deviation === "number" ? (summary.deviation > 0 ? "+" : "") + summary.deviation : "n/a"}`);
    }
    return await finish(
      "success",
      `Submitted ${done.length} report${done.length === 1 ? "" : "s"} (deviation in children) — ${deviations.join(", ")}.` +
        (waiting.length ? ` Still waiting on inventory reports for: ${waiting.join(", ")}.` : ""),
      done,
      ids,
    );
  } catch (err) {
    console.error("[canteenAutomation] failed", err);
    await finish("failed", err instanceof Error ? err.message : String(err));
  }
}

export const runAutomation = internalAction({
  args: { automationId: v.id("automations"), trigger: v.union(v.literal("schedule"), v.literal("manual")) },
  handler: async (ctx, { automationId, trigger }) => {
    await runOne(ctx, automationId, trigger);
  },
});

export const listEnabled = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("automations").collect()).filter((a) => a.enabled && a.kind === KIND).map((a) => a._id),
});

/** Cron entry point. */
export const runAllScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const id of await ctx.runQuery(internal.canteenAutomation.listEnabled, {})) {
      await runOne(ctx, id, "schedule");
    }
  },
});
