import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireProfile, requireRole } from "./lib/roles";

/** Automations for the caller's organization, each with its most recent run. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const automations = await ctx.db
      .query("automations")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    return await Promise.all(
      automations.map(async (a) => {
        const runs = await ctx.db
          .query("automationRuns")
          .withIndex("by_automationId", (q) => q.eq("automationId", a._id))
          .order("desc")
          .take(1);
        const template = a.outputTemplateId ? await ctx.db.get(a.outputTemplateId) : null;
        return { ...a, lastRun: runs[0] ?? null, outputTemplateName: template?.name ?? null };
      }),
    );
  },
});

export const runs = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const profile = await requireProfile(ctx);
    const a = await ctx.db.get(automationId);
    if (!a || a.orgId !== profile.orgId) return [];
    return await ctx.db
      .query("automationRuns")
      .withIndex("by_automationId", (q) => q.eq("automationId", automationId))
      .order("desc")
      .take(100);
  },
});

/** The reports an automation has submitted, newest first, with a download link for each file. */
export const submittedWork = query({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const profile = await requireProfile(ctx);
    const a = await ctx.db.get(automationId);
    if (!a || a.orgId !== profile.orgId || !a.outputTemplateId) return [];
    const templateId = a.outputTemplateId;
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .collect();
    subs.sort((x, y) => y.periodStart - x.periodStart);
    return await Promise.all(
      subs.slice(0, 60).map(async (s) => {
        const files = await ctx.db
          .query("submissionFiles")
          .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
          .collect();
        const f = files[0];
        const meta = f?.extracted?.metadata;
        return {
          submissionId: s._id,
          periodLabel: s.periodLabel,
          status: s.status,
          submittedAt: s.submittedAt ?? null,
          score: s.finalScore ?? null,
          fileName: f?.fileName ?? null,
          url: f ? await ctx.storage.getUrl(f.storageId) : null,
          deviation: typeof meta?.deviation === "number" ? meta.deviation : null,
          expected: typeof meta?.expectedChildren === "number" ? meta.expectedChildren : null,
          actual: typeof meta?.actualChildren === "number" ? meta.actualChildren : null,
        };
      }),
    );
  },
});

export const setEnabled = mutation({
  args: { automationId: v.id("automations"), enabled: v.boolean() },
  handler: async (ctx, { automationId, enabled }) => {
    const profile = await requireRole(ctx, ["admin"]);
    const a = await ctx.db.get(automationId);
    if (!a || a.orgId !== profile.orgId) throw new Error("Automation not found");
    await ctx.db.patch(automationId, { enabled });
  },
});

export const runNow = mutation({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const profile = await requireRole(ctx, ["admin"]);
    const a = await ctx.db.get(automationId);
    if (!a || a.orgId !== profile.orgId) throw new Error("Automation not found");
    await ctx.scheduler.runAfter(0, internal.canteenAutomation.runAutomation, {
      automationId,
      trigger: "manual",
    });
  },
});
