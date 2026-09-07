import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireProfile } from "./lib/roles";
import { statusForScore } from "./lib/scoring";

const TREND_POINTS = 12;

export const organizationDashboard = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    try {
      const profile = await requireProfile(ctx);
      if (profile.orgId !== orgId) return null;

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

          const templates = await ctx.db
            .query("reportTemplates")
            .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
            .collect();

          const reports = await Promise.all(
            templates.map(async (tpl) => {
              const latestSub = await ctx.db
                .query("submissions")
                .withIndex("by_templateId", (q) => q.eq("templateId", tpl._id))
                .order("desc")
                .first();

              let validationScore: number | null = null;
              if (latestSub) {
                const valResult = await ctx.db
                  .query("validationResults")
                  .withIndex("by_submissionId", (q) => q.eq("submissionId", latestSub._id))
                  .order("desc")
                  .first();
                validationScore = valResult?.score ?? latestSub.finalScore ?? null;
              }

              return {
                _id: tpl._id,
                name: tpl.name,
                cadence: tpl.cadence,
                validatorKey: tpl.validatorKey,
                latestStatus: latestSub?.status ?? "missing",
                submittedAt: latestSub?.submittedAt,
                dueAt: latestSub?.dueAt,
                periodLabel: latestSub?.periodLabel,
                qualityScore: validationScore,
              };
            }),
          );

          const submittedCount = reports.filter((r) => r.latestStatus === "submitted").length;
          const lateCount = reports.filter((r) => r.latestStatus === "late").length;
          const missingCount = reports.filter((r) => r.latestStatus === "missing").length;
          const pendingCount = reports.filter((r) => r.latestStatus === "pending").length;

          return {
            department: dept,
            hasData: latest !== undefined || reports.some((r) => r.latestStatus !== "missing"),
            healthScore: latest?.healthScore ?? 0,
            submissionRate: latest?.submissionRate ?? (reports.length > 0 ? Math.round(((submittedCount + lateCount) / reports.length) * 100) : 0),
            qualityScore: latest?.qualityScore ?? 0,
            submittedCount,
            lateCount: latest?.lateCount ?? lateCount,
            missingCount: latest?.missingCount ?? missingCount,
            pendingCount,
            status: statusForScore(latest?.healthScore ?? 0),
            trend: history.reverse().map((h) => ({ periodLabel: h.periodLabel, score: h.healthScore })),
            reports,
          };
        }),
      );

      return {
        organization: org,
        hasData: orgScoreHistory.length > 0,
        healthScore: orgScoreHistory[0]?.healthScore ?? 0,
        status: statusForScore(orgScoreHistory[0]?.healthScore ?? 0),
        trend: [...orgScoreHistory].reverse().map((h) => ({ periodLabel: h.periodLabel, score: h.healthScore })),
        departments: departmentCards,
      };
    } catch {
      return null;
    }
  },
});

export const departmentDashboard = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    try {
      const profile = await requireProfile(ctx);

      const department = await ctx.db.get(departmentId);
      if (!department || department.orgId !== profile.orgId) return null;
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
                .order("desc")
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
            hasData: submissions.length > 0,
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
        hasData: scoreHistory.length > 0,
        healthScore: latestScore?.healthScore ?? 0,
        status: statusForScore(latestScore?.healthScore ?? 0),
        submissionRate: latestScore?.submissionRate ?? 0,
        qualityScore: latestScore?.qualityScore ?? 0,
        trend: [...scoreHistory].reverse().map((h) => ({ periodLabel: h.periodLabel, score: h.healthScore })),
        reports: reportCards,
      };
    } catch {
      return null;
    }
  },
});

export const reportDetail = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    try {
      const profile = await requireProfile(ctx);

      const template = await ctx.db.get(templateId);
      if (!template) return null;
      const dept = await ctx.db.get(template.departmentId);
      if (!dept || dept.orgId !== profile.orgId) return null;
      
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
            .order("desc")
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
    } catch {
      return null;
    }
  },
});
