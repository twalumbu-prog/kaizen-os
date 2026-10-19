import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

export const KIND = "zanacoBankRecon";
export const TEMPLATE_NAME = "Zanaco Bank Reconciliation";
export const MF_FILE_LABEL = "Master Fees Zanaco Data";
export const BANK_FILE_LABEL = "Zanaco Bank Statement";

const DAY_MS = 86_400_000;

export function dayBounds(dateStr: string): {
  periodStart: number;
  periodEnd: number;
  dueAt: number;
} {
  const start = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  const end = start + DAY_MS - 1;
  const dueAt = start + DAY_MS + 9 * 60 * 60 * 1000;
  return { periodStart: start, periodEnd: end, dueAt };
}

// ── Setup ────────────────────────────────────────────────────────────────────

export const seedForAllOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const created: string[] = [];

    for (const org of orgs) {
      const depts = await ctx.db
        .query("departments")
        .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
        .collect();

      const finance = depts.find((d) => d.name.toLowerCase().includes("finance"));
      if (!finance) continue;

      const existing = await ctx.db
        .query("reportTemplates")
        .withIndex("by_departmentId", (q) => q.eq("departmentId", finance._id))
        .filter((q) => q.eq(q.field("validatorKey"), KIND))
        .first();

      let templateId = existing?._id;
      if (!templateId) {
        templateId = await ctx.db.insert("reportTemplates", {
          departmentId: finance._id,
          name: TEMPLATE_NAME,
          cadence: "daily",
          validatorKey: KIND,
          weight: 1,
          sharingMode: "shared",
          excludedDaysOfWeek: [0, 6],
          requiredFiles: [
            { label: BANK_FILE_LABEL, fileTypes: ["csv", "xlsx", "pdf"], required: true },
          ],
          validationRules: [],
          outcomeBenchmark: {
            metricKey: "bankMatchDelta",
            metricLabel: "MF vs Bank delta (should be 0)",
            showBenchmarkOnChart: false,
          },
        });
        created.push(`template for ${org.name}`);
      }

      const existingAuto = await ctx.db
        .query("automations")
        .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
        .filter((q) => q.eq(q.field("kind"), KIND))
        .first();

      if (!existingAuto) {
        await ctx.db.insert("automations", {
          orgId: org._id,
          kind: KIND,
          name: TEMPLATE_NAME,
          description:
            "Each night, fetches the day's Zanaco bank inflows from Master Fees and pre-populates the reconciliation report. The finance team uploads the Zanaco bank statement to complete the 3-way check.",
          schedule: "Daily at 22:00 UTC",
          enabled: true,
          outputTemplateId: templateId,
        });
        created.push(`automation for ${org.name}`);
      }
    }

    return { created };
  },
});

// ── Automation run tracking ──────────────────────────────────────────────────

export const listEnabledAutomations = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("automations").collect();
    return all.filter((a) => a.kind === KIND && a.enabled && !!a.outputTemplateId);
  },
});

export const startRun = internalMutation({
  args: { automationId: v.id("automations"), date: v.string() },
  handler: async (ctx, { automationId, date }) => {
    const auto = await ctx.db.get(automationId);
    if (!auto) throw new Error("Automation not found");
    return ctx.db.insert("automationRuns", {
      automationId,
      orgId: auto.orgId,
      trigger: "schedule",
      status: "running",
      startedAt: Date.now(),
      message: "",
      datesProcessed: [date],
      submissionIds: [],
    });
  },
});

export const finishRun = internalMutation({
  args: {
    runId: v.id("automationRuns"),
    status: v.union(v.literal("success"), v.literal("failed"), v.literal("skipped")),
    date: v.string(),
    submissionId: v.optional(v.id("submissions")),
  },
  handler: async (ctx, { runId, status, submissionId }) => {
    await ctx.db.patch(runId, {
      status,
      finishedAt: Date.now(),
      ...(submissionId ? { submissionIds: [submissionId] } : {}),
    });
  },
});

export const getOrgAdminProfile = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    return ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("role"), "admin"))
      .first();
  },
});

export const upsertSubmission = internalMutation({
  args: {
    templateId: v.id("reportTemplates"),
    userId: v.id("users"),
    periodLabel: v.string(),
    periodStart: v.number(),
    periodEnd: v.number(),
    dueAt: v.number(),
    mfStorageId: v.id("_storage"),
    mfTotal: v.number(),
    transactionCount: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_templateId_periodLabel", (q) =>
        q.eq("templateId", args.templateId).eq("periodLabel", args.periodLabel)
      )
      .first();

    let submissionId: Id<"submissions">;
    if (existing) {
      submissionId = existing._id;
    } else {
      submissionId = await ctx.db.insert("submissions", {
        templateId: args.templateId,
        userId: args.userId,
        periodLabel: args.periodLabel,
        periodStart: args.periodStart,
        periodEnd: args.periodEnd,
        dueAt: args.dueAt,
        status: "pending",
        isAutoSubmitted: false,
      });
    }

    const existingMfFile = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId))
      .filter((q) => q.eq(q.field("label"), MF_FILE_LABEL))
      .first();

    if (existingMfFile) {
      await ctx.db.patch(existingMfFile._id, {
        storageId: args.mfStorageId,
        extracted: {
          transactionCount: args.transactionCount,
          metadata: { mfTotal: args.mfTotal },
        },
      });
    } else {
      await ctx.db.insert("submissionFiles", {
        submissionId,
        storageId: args.mfStorageId,
        label: MF_FILE_LABEL,
        fileType: "csv",
        fileName: `mf-zanaco-${args.periodLabel}.json`,
        extracted: {
          transactionCount: args.transactionCount,
          metadata: { mfTotal: args.mfTotal },
        },
      });
    }

    return submissionId;
  },
});

// ── Public API ───────────────────────────────────────────────────────────────

export const getReconForDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile) return null;

    const depts = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();

    let template = null;
    for (const dept of depts) {
      template = await ctx.db
        .query("reportTemplates")
        .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
        .filter((q) => q.eq(q.field("validatorKey"), KIND))
        .first();
      if (template) break;
    }
    if (!template) return { template: null, submission: null, mfFile: null, bankFile: null };

    const submission = await ctx.db
      .query("submissions")
      .withIndex("by_templateId_periodLabel", (q) =>
        q.eq("templateId", template!._id).eq("periodLabel", date)
      )
      .first();

    if (!submission) {
      return { template, submission: null, mfFile: null, bankFile: null };
    }

    const files = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submissionId", (q) => q.eq("submissionId", submission._id))
      .collect();

    const mfFile = files.find((f) => f.label === MF_FILE_LABEL) ?? null;
    const bankFile = files.find((f) => f.label === BANK_FILE_LABEL) ?? null;

    return { template, submission, mfFile, bankFile };
  },
});

export const attachBankStatement = mutation({
  args: {
    submissionId: v.id("submissions"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.union(
      v.literal("csv"),
      v.literal("xlsx"),
      v.literal("pdf"),
      v.literal("jpg"),
      v.literal("png"),
      v.literal("docx")
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submissionId", (q) => q.eq("submissionId", args.submissionId))
      .filter((q) => q.eq(q.field("label"), BANK_FILE_LABEL))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        storageId: args.storageId,
        fileName: args.fileName,
        fileType: args.fileType,
        extracted: undefined,
      });
      return existing._id;
    }
    return ctx.db.insert("submissionFiles", {
      submissionId: args.submissionId,
      storageId: args.storageId,
      label: BANK_FILE_LABEL,
      fileType: args.fileType,
      fileName: args.fileName,
    });
  },
});
