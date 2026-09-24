import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const ZANACO_TEMPLATE_ID = "m5750x3v9nnnrn4abxcc836bp58etr09" as Id<"reportTemplates">;
const DAY_MS = 86_400_000;

/** Snap back to the most recent Friday (weekly periods run Fri–Thu). */
function weekStart(ms: number): Date {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  const diff = (d.getUTCDay() - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function generateWeeklyPeriods() {
  const first = weekStart(Date.UTC(2026, 0, 2));   // Jan 2, 2026 → Fri
  const lastMs = Date.UTC(2026, 8, 24);             // Sep 24, 2026
  const periods: { periodLabel: string; periodStart: number; periodEnd: number; dueAt: number }[] = [];
  let cur = new Date(first);
  while (cur.getTime() <= lastMs) {
    const end = new Date(cur);
    end.setUTCDate(end.getUTCDate() + 6);
    end.setUTCHours(23, 59, 59, 999);
    const due = new Date(end);
    due.setUTCDate(due.getUTCDate() + 1);
    due.setUTCHours(17, 0, 0, 0);
    periods.push({
      periodLabel: "Week of " + cur.toISOString().slice(0, 10),
      periodStart: cur.getTime(),
      periodEnd:   end.getTime(),
      dueAt:       due.getTime(),
    });
    cur = new Date(cur);
    cur.setUTCDate(cur.getUTCDate() + 7);
  }
  return periods;
}

// ── Step 1: Upload the CSV and get a storageId ─────────────────────────────────
// Run: npx convex run seedZanacoBankRecon:uploadCsv '{"csvBase64":"<base64>"}' --prod
export const uploadCsv = internalAction({
  args: { csvBase64: v.string() },
  handler: async (ctx, { csvBase64 }) => {
    const binary = atob(csvBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const storageId = await ctx.storage.store(new Blob([bytes], { type: "text/csv" }));
    console.log("[seedZanaco] CSV uploaded, storageId:", storageId);
    return { storageId };
  },
});

// ── Idempotent single-submission upsert ───────────────────────────────────────
export const upsertSubmission = internalMutation({
  args: {
    templateId:  v.id("reportTemplates"),
    userId:      v.id("users"),
    storageId:   v.id("_storage"),
    periodLabel: v.string(),
    periodStart: v.number(),
    periodEnd:   v.number(),
    dueAt:       v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", q => q.eq("templateId", args.templateId))
      .filter(q => q.eq(q.field("periodLabel"), args.periodLabel))
      .first();

    let submissionId: Id<"submissions">;
    if (existing) {
      submissionId = existing._id;
      // Replace any old bank-statement files.
      const oldFiles = await ctx.db
        .query("submissionFiles")
        .withIndex("by_submissionId", q => q.eq("submissionId", submissionId))
        .collect();
      for (const f of oldFiles) {
        if (f.label.toLowerCase().includes("zanaco") || f.label.toLowerCase().includes("bank statement")) {
          await ctx.db.delete(f._id);
        }
      }
    } else {
      submissionId = await ctx.db.insert("submissions", {
        templateId:      args.templateId,
        userId:          args.userId,
        periodLabel:     args.periodLabel,
        periodStart:     args.periodStart,
        periodEnd:       args.periodEnd,
        dueAt:           args.dueAt,
        status:          "late",
        isAutoSubmitted: true,
        submittedAt:     args.periodEnd + DAY_MS,
      });
    }

    await ctx.db.insert("submissionFiles", {
      submissionId,
      storageId: args.storageId,
      label:     "Zanaco Bank Statement",
      fileType:  "csv",
      fileName:  "zanaco_statement_2026.csv",
    });

    await ctx.db.patch(submissionId, {
      status:      "late",
      submittedAt: args.periodEnd + DAY_MS,
    });

    return submissionId;
  },
});

export const setTemplateWeekly = internalMutation({
  args: {},
  handler: async (ctx) => {
    const t = await ctx.db.get(ZANACO_TEMPLATE_ID);
    if (!t) throw new Error("Zanaco template not found");
    if (t.cadence !== "weekly") {
      await ctx.db.patch(ZANACO_TEMPLATE_ID, { cadence: "weekly" });
      return "updated to weekly";
    }
    return "already weekly";
  },
});

export const findAdminUser = internalMutation({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Template not found");
    const dept = await ctx.db.get(template.departmentId);
    if (!dept) throw new Error("Department not found");
    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", q => q.eq("orgId", dept.orgId))
      .collect();
    const adminProfile = profiles.find(p => p.role === "admin");
    if (!adminProfile) throw new Error("No admin profile found");
    return adminProfile.userId;
  },
});

// ── Step 2: Create all weekly submissions ─────────────────────────────────────
// Run: npx convex run seedZanacoBankRecon:run '{"storageId":"<id>"}' --prod
export const run = internalAction({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const cadenceResult = await ctx.runMutation(internal.seedZanacoBankRecon.setTemplateWeekly, {});
    console.log("[seedZanaco] Cadence:", cadenceResult);

    const adminUserId = await ctx.runMutation(internal.seedZanacoBankRecon.findAdminUser, {
      templateId: ZANACO_TEMPLATE_ID,
    });
    console.log("[seedZanaco] Admin:", adminUserId);

    const periods = generateWeeklyPeriods();
    console.log("[seedZanaco] Creating", periods.length, "weekly submissions...");

    for (const p of periods) {
      await ctx.runMutation(internal.seedZanacoBankRecon.upsertSubmission, {
        templateId:  ZANACO_TEMPLATE_ID,
        userId:      adminUserId,
        storageId,
        periodLabel: p.periodLabel,
        periodStart: p.periodStart,
        periodEnd:   p.periodEnd,
        dueAt:       p.dueAt,
      });
      console.log("[seedZanaco]  ✓", p.periodLabel);
    }

    console.log("[seedZanaco] Done.", periods.length, "submissions created.");
    return { submissionsCreated: periods.length };
  },
});
