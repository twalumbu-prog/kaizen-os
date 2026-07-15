import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireProfile } from "./lib/roles";
import { statusForScore } from "./lib/scoring";

const TREND_POINTS = 12;

export const organizationDashboard = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireProfile(ctx);

    const org = await ctx.db.get(orgId);
    const departments = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();

    const orgScoreHistory = await ctx.db
      .query("organizationScores")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .order("desc")
      .take(TREND_POINTS);

    const departmentCards = await Promise.all(
      departments.map(async (dept) => {
        const history = await ctx.db
          .query("departmentScores")
          .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
          .order("desc")
          .take(TREND_POINTS);
        const latest = history[0];
        return {
          department: dept,
          healthScore: latest?.healthScore ?? 0,
          submissionRate: latest?.submissionRate ?? 0,
          qualityScore: latest?.qualityScore ?? 0,
          lateCount: latest?.lateCount ?? 0,
          missingCount: latest?.missingCount ?? 0,
          status: statusForScore(latest?.healthScore ?? 0),
          trend: history.reverse().map((h) => ({ periodLabel: h.periodLabel, score: h.healthScore })),
        };
      }),
    );

    return {
      organization: org,
      healthScore: orgScoreHistory[0]?.healthScore ?? 0,
      status: statusForScore(orgScoreHistory[0]?.healthScore ?? 0),
      trend: [...orgScoreHistory].reverse().map((h) => ({ periodLabel: h.periodLabel, score: h.healthScore })),
      departments: departmentCards,
    };
  },
});

export const departmentDashboard = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    await requireProfile(ctx);

    const department = await ctx.db.get(departmentId);
    const templates = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .collect();

    const scoreHistory = await ctx.db
      .query("departmentScores")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .order("desc")
      .take(TREND_POINTS);
    const latestScore = scoreHistory[0];

    const reportCards = await Promise.all(
      templates.map(async (template) => {
        const submissions = await ctx.db
          .query("submissions")
          .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
          .order("desc")
          .take(TREND_POINTS);
        const latest = submissions[0];

        const validationResults = await Promise.all(
          submissions.map((s) =>
            ctx.db
              .query("validationResults")
              .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
              .first(),
          ),
        );
        const qualityScores = validationResults.filter((v): v is NonNullable<typeof v> => v !== null);
        const avgQuality =
          qualityScores.length === 0
            ? 0
            : Math.round(qualityScores.reduce((sum, v) => sum + v.score, 0) / qualityScores.length);

        const submitted = submissions.filter((s) => s.status === "submitted" || s.status === "late").length;
        const submissionRatePct =
          submissions.length === 0 ? 0 : Math.round((submitted / submissions.length) * 100);
        const missingCount = submissions.filter((s) => s.status === "missing").length;

        const healthScore = latest?.finalScore ?? 0;

        return {
          template,
          healthScore,
          status: statusForScore(healthScore),
          submissionRate: submissionRatePct,
          qualityScore: avgQuality,
          trend: [...submissions].reverse().map((s) => ({
            periodLabel: s.periodLabel,
            score: s.finalScore ?? 0,
          })),
          lastSubmittedAt: latest?.submittedAt,
          missingCount,
        };
      }),
    );

    return {
      department,
      healthScore: latestScore?.healthScore ?? 0,
      status: statusForScore(latestScore?.healthScore ?? 0),
      submissionRate: latestScore?.submissionRate ?? 0,
      qualityScore: latestScore?.qualityScore ?? 0,
      trend: [...scoreHistory].reverse().map((h) => ({ periodLabel: h.periodLabel, score: h.healthScore })),
      reports: reportCards,
    };
  },
});

export const reportDetail = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (!template) return null;

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .order("desc")
      .take(52);

    const timeline = await Promise.all(
      submissions.map(async (s) => {
        const employee = await ctx.db.get(s.userId);
        const validationResult = await ctx.db
          .query("validationResults")
          .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
          .first();
        return {
          submission: s,
          employeeName: employee && "name" in employee ? employee.name : "Unknown",
          qualityScore: validationResult?.score,
          status: statusForScore(s.finalScore ?? 0),
        };
      }),
    );

    return { template, timeline: timeline.reverse() };
  },
});
