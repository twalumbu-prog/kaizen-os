import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireProfile } from "./lib/roles";
import {
  departmentHealthScore,
  organizationHealthScore,
  submissionRate,
} from "./lib/scoring";
import type { Doc, Id } from "./_generated/dataModel";

const HISTORY_WINDOW = 12;

/**
 * Recomputes and snapshots a department's health score from each of its
 * report templates' most recent submissions. Called after a submission's
 * validation completes, and whenever an admin edits report configuration.
 */
export const recomputeDepartmentScore = internalMutation({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    const templates = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .collect();

    const reportScores: { score: number; weight: number }[] = [];
    let lateCount = 0;
    let missingCount = 0;
    const allStatuses: Doc<"submissions">["status"][] = [];
    const qualityScores: number[] = [];

    for (const template of templates) {
      const recentSubmissions = await ctx.db
        .query("submissions")
        .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
        .order("desc")
        .take(HISTORY_WINDOW);

      for (const submission of recentSubmissions) {
        allStatuses.push(submission.status);
        if (submission.status === "late") lateCount++;
        if (submission.status === "missing") missingCount++;
      }

      const latest = recentSubmissions[0];
      if (latest?.finalScore !== undefined) {
        reportScores.push({ score: latest.finalScore, weight: template.weight });
      }

      const validationResults = await Promise.all(
        recentSubmissions.map((s) =>
          ctx.db
            .query("validationResults")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
            .order("desc")
            .first(),
        ),
      );
      for (const vr of validationResults) {
        if (vr) qualityScores.push(vr.score);
      }
    }

    const healthScore = departmentHealthScore(reportScores);
    const avgQuality =
      qualityScores.length === 0
        ? 100
        : Math.round(qualityScores.reduce((s, q) => s + q, 0) / qualityScores.length);

    const periodLabel = new Date().toISOString().slice(0, 10);

    await ctx.db.insert("departmentScores", {
      departmentId,
      periodLabel,
      healthScore,
      submissionRate: submissionRate(allStatuses),
      qualityScore: avgQuality,
      lateCount,
      missingCount,
      computedAt: Date.now(),
    });

    const department = await ctx.db.get(departmentId);
    if (department) {
      await recomputeOrganizationScoreInternal(ctx, department.orgId);
    }

    return healthScore;
  },
});

async function recomputeOrganizationScoreInternal(
  ctx: MutationCtx,
  orgId: Id<"organizations">,
) {
  const departments = await ctx.db
    .query("departments")
    .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
    .collect();

  const scores: { score: number; weight: number }[] = [];
  for (const dept of departments) {
    const latest = await ctx.db
      .query("departmentScores")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
      .order("desc")
      .first();
    if (latest) scores.push({ score: latest.healthScore, weight: 1 });
  }

  const healthScore = organizationHealthScore(scores);
  await ctx.db.insert("organizationScores", {
    orgId,
    periodLabel: new Date().toISOString().slice(0, 10),
    healthScore,
    computedAt: Date.now(),
  });
}

export const departmentScoreHistory = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    await requireProfile(ctx);
    const rows = await ctx.db
      .query("departmentScores")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .order("desc")
      .take(HISTORY_WINDOW);
    return rows.reverse();
  },
});

export const organizationScoreHistory = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireProfile(ctx);
    const rows = await ctx.db
      .query("organizationScores")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(HISTORY_WINDOW);
    return rows.reverse();
  },
});
