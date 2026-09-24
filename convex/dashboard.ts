import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireProfile } from "./lib/roles";
import { isExcludedDay } from "./lib/periods";
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
              let studentCount: number | null = null;
              let grandTotal: number | null = null;

              if (latestSub) {
                const valResult = await ctx.db
                  .query("validationResults")
                  .withIndex("by_submissionId", (q) => q.eq("submissionId", latestSub._id))
                  .order("desc")
                  .first();
                validationScore = valResult?.score ?? latestSub.finalScore ?? null;

                const subFiles = await ctx.db
                  .query("submissionFiles")
                  .withIndex("by_submissionId", (q) => q.eq("submissionId", latestSub._id))
                  .collect();

                for (const f of subFiles) {
                  if (f.extracted?.metadata) {
                    if (f.extracted.metadata.studentCount !== undefined && f.extracted.metadata.studentCount !== null) {
                      studentCount = Number(f.extracted.metadata.studentCount);
                    }
                    if (f.extracted.metadata.grandTotal !== undefined && f.extracted.metadata.grandTotal !== null) {
                      grandTotal = Number(f.extracted.metadata.grandTotal);
                    }
                  }
                }
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
                studentCount,
                grandTotal,
                outcomeBenchmark: tpl.outcomeBenchmark,
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

          const outcomeSubmissions = await Promise.all(
            submissions.map(async (s) => {
              const subFiles = await ctx.db
                .query("submissionFiles")
                .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
                .collect();

              const targetKey = template.outcomeBenchmark?.metricKey ?? "studentCount";
              let outcomeValue: number | null = null;
              let studentCount: number | null = null;
              let grandTotal: number | null = null;
              for (const f of subFiles) {
                if (f.extracted) {
                  if (targetKey === "closingBalance" && f.extracted.closingBalance !== undefined && f.extracted.closingBalance !== null) {
                    outcomeValue = f.extracted.closingBalance;
                  }
                  if (targetKey === "openingBalance" && f.extracted.openingBalance !== undefined && f.extracted.openingBalance !== null) {
                    outcomeValue = f.extracted.openingBalance;
                  }
                  if (targetKey === "transactionCount" && f.extracted.transactionCount !== undefined && f.extracted.transactionCount !== null) {
                    outcomeValue = f.extracted.transactionCount;
                  }
                  if (f.extracted.metadata) {
                    if (f.extracted.metadata.studentCount !== undefined && f.extracted.metadata.studentCount !== null) {
                      studentCount = Number(f.extracted.metadata.studentCount);
                    }
                    if (f.extracted.metadata.grandTotal !== undefined && f.extracted.metadata.grandTotal !== null) {
                      grandTotal = Number(f.extracted.metadata.grandTotal);
                    }
                    if (f.extracted.metadata[targetKey] !== undefined && f.extracted.metadata[targetKey] !== null) {
                      const val = Number(f.extracted.metadata[targetKey]);
                      if (!isNaN(val)) outcomeValue = val;
                    }
                  }
                }
              }
              const finalVal = outcomeValue !== null ? outcomeValue : studentCount;
              return {
                submission: s,
                studentCount: finalVal,
                grandTotal,
              };
            }),
          );

          const validStudentCounts = outcomeSubmissions
            .map((o) => o.studentCount)
            .filter((c): c is number => c !== null && c !== undefined);

          const avgStudentCount =
            validStudentCounts.length > 0
              ? Math.round(validStudentCounts.reduce((sum, c) => sum + c, 0) / validStudentCounts.length)
              : null;
          const latestStudentCount = validStudentCounts.length > 0 ? validStudentCounts[0] : null;

          const outcomeTrend = outcomeSubmissions
            .filter((o) => o.studentCount !== null && o.studentCount !== undefined)
            .reverse()
            .map((o) => ({
              periodLabel: o.submission.periodLabel,
              score: o.studentCount!,
            }));

          const healthScore = latest?.finalScore ?? 0;

          return {
            template,
            hasData: submissions.length > 0,
            healthScore,
            status: statusForScore(healthScore),
            submissionRate: submissionRatePct,
            qualityScore: avgQuality,
            avgStudentCount,
            latestStudentCount,
            outcomeTrend: outcomeTrend.length > 0 ? outcomeTrend : [...submissions].reverse().map((s) => ({
              periodLabel: s.periodLabel,
              score: s.finalScore ?? 0,
            })),
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
      
      const allSubmissions = await ctx.db
        .query("submissions")
        .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
        .order("desc")
        .take(52);

      const submissions = allSubmissions.filter(
        (s) =>
          !(
            (s.status === "missing" || s.status === "pending") &&
            isExcludedDay(new Date(s.periodStart), template)
          ),
      );

      const timeline = await Promise.all(
        submissions.map(async (s) => {
          const employee = await ctx.db.get(s.userId);
          const validationResult = await ctx.db
            .query("validationResults")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
            .order("desc")
            .first();

          const subFiles = await ctx.db
            .query("submissionFiles")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
            .collect();

          const targetKey = template.outcomeBenchmark?.metricKey ?? "studentCount";
          let outcomeValue: number | null = null;
          let studentCount: number | null = null;
          let grandTotal: number | null = null;
          for (const f of subFiles) {
            if (f.extracted) {
              if (targetKey === "closingBalance" && f.extracted.closingBalance !== undefined && f.extracted.closingBalance !== null) {
                outcomeValue = f.extracted.closingBalance;
              }
              if (targetKey === "openingBalance" && f.extracted.openingBalance !== undefined && f.extracted.openingBalance !== null) {
                outcomeValue = f.extracted.openingBalance;
              }
              if (targetKey === "transactionCount" && f.extracted.transactionCount !== undefined && f.extracted.transactionCount !== null) {
                outcomeValue = f.extracted.transactionCount;
              }
              if (f.extracted.metadata) {
                if (f.extracted.metadata.studentCount !== undefined && f.extracted.metadata.studentCount !== null) {
                  studentCount = Number(f.extracted.metadata.studentCount);
                }
                if (f.extracted.metadata.grandTotal !== undefined && f.extracted.metadata.grandTotal !== null) {
                  grandTotal = Number(f.extracted.metadata.grandTotal);
                }
                if (f.extracted.metadata[targetKey] !== undefined && f.extracted.metadata[targetKey] !== null) {
                  const val = Number(f.extracted.metadata[targetKey]);
                  if (!isNaN(val)) outcomeValue = val;
                }
              }
            }
          }

          const finalVal = outcomeValue !== null ? outcomeValue : studentCount;
          return {
            submission: s,
            employeeName: employee && "name" in employee ? employee.name : "Unknown",
            qualityScore: validationResult?.score,
            status: statusForScore(s.finalScore ?? 0),
            studentCount: finalVal,
            grandTotal,
          };
        }),
      );

      // Sort timeline strictly in chronological order by periodStart
      timeline.sort((a, b) => a.submission.periodStart - b.submission.periodStart);

      return { template, timeline };
    } catch {
      return null;
    }
  },
});
