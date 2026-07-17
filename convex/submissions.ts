import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { CHECKLIST_STATUS, FILE_TYPE } from "./schema";
import { requireProfile } from "./lib/roles";
import { currentPeriod } from "./lib/periods";
import { finalReportScore, submissionScore as computeSubmissionScore } from "./lib/scoring";

/** Loads everything the Node-runtime validation action needs in one query. */
export const loadForValidation = internalQuery({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    const submission = await ctx.db.get(submissionId);
    if (!submission) return null;
    const template = await ctx.db.get(submission.templateId);
    if (!template) return null;
    const files = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId))
      .collect();
    return { submission, template, files };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireProfile(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Ensures a submission row exists for the current period, for the calling user. */
export const getOrCreateCurrentSubmission = mutation({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const profile = await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Report template not found");
    const { periodLabel, dueAt } = currentPeriod(template.cadence);

    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_templateId_periodLabel", (q) =>
        q.eq("templateId", templateId).eq("periodLabel", periodLabel),
      )
      .filter((q) => q.eq(q.field("userId"), profile.userId))
      .unique();
    if (existing) return existing._id;

    return await ctx.db.insert("submissions", {
      templateId,
      userId: profile.userId,
      periodLabel,
      dueAt,
      status: "pending",
    });
  },
});

export const submitReport = mutation({
  args: {
    submissionId: v.id("submissions"),
    files: v.array(
      v.object({
        storageId: v.id("_storage"),
        label: v.string(),
        fileType: FILE_TYPE,
        fileName: v.string(),
      }),
    ),
  },
  handler: async (ctx, { submissionId, files }) => {
    const profile = await requireProfile(ctx);
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error("Submission not found");
    if (submission.userId !== profile.userId && profile.role === "employee") {
      throw new Error("You can only submit your own reports");
    }

    for (const file of files) {
      await ctx.db.insert("submissionFiles", { submissionId, ...file });
    }

    const now = Date.now();
    const status = now <= submission.dueAt ? "submitted" : "late";
    const subScore = computeSubmissionScore({ status, dueAt: submission.dueAt, submittedAt: now });
    await ctx.db.patch(submissionId, { submittedAt: now, status, submissionScore: subScore });

    await ctx.scheduler.runAfter(0, internal.validationRunner.runValidation, { submissionId });
    return null;
  },
});

/** Persists a validation run's outcome. Called from the Node action after running a validator. */
export const saveValidationResult = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    score: v.number(),
    summary: v.string(),
    checklist: v.array(
      v.object({
        title: v.string(),
        status: CHECKLIST_STATUS,
        explanation: v.string(),
        severity: v.string(),
        points: v.number(),
        maxPoints: v.number(),
      }),
    ),
  },
  handler: async (ctx, { submissionId, score, summary, checklist }) => {
    const submission = await ctx.db.get(submissionId);
    if (!submission) throw new Error("Submission not found");

    const validationResultId = await ctx.db.insert("validationResults", {
      submissionId,
      score,
      summary,
      computedAt: Date.now(),
    });

    for (const item of checklist) {
      await ctx.db.insert("validationChecklistItems", { validationResultId, ...item });
    }

    const finalScore = finalReportScore(submission.submissionScore ?? 0, score);
    await ctx.db.patch(submissionId, { finalScore });

    const template = await ctx.db.get(submission.templateId);
    if (template) {
      await ctx.scheduler.runAfter(0, internal.scores.recomputeDepartmentScore, {
        departmentId: template.departmentId,
      });
    }

    return validationResultId;
  },
});

export const getSubmission = query({
  args: { submissionId: v.id("submissions") },
  handler: async (ctx, { submissionId }) => {
    await requireProfile(ctx);
    const submission = await ctx.db.get(submissionId);
    if (!submission) return null;

    const [template, employee, files, validationResult] = await Promise.all([
      ctx.db.get(submission.templateId),
      ctx.db.get(submission.userId),
      ctx.db
        .query("submissionFiles")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId))
        .collect(),
      ctx.db
        .query("validationResults")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId))
        .order("desc")
        .first(),
    ]);

    const checklist = validationResult
      ? await ctx.db
          .query("validationChecklistItems")
          .withIndex("by_validationResultId", (q) => q.eq("validationResultId", validationResult._id))
          .collect()
      : [];

    const fileUrls = await Promise.all(
      files.map(async (f) => ({ ...f, url: await ctx.storage.getUrl(f.storageId) })),
    );

    return {
      submission,
      template,
      employeeName: employee ? "name" in employee ? employee.name : undefined : undefined,
      files: fileUrls,
      validationResult,
      checklist,
    };
  },
});

export const listSubmissionsForTemplate = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireProfile(ctx);
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .order("desc")
      .take(52);

    return await Promise.all(
      submissions.map(async (s) => {
        const [employee, validationResult] = await Promise.all([
          ctx.db.get(s.userId),
          ctx.db
            .query("validationResults")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
            .order("desc")
            .first(),
        ]);
        return {
          ...s,
          employeeName: employee && "name" in employee ? employee.name : "Unknown",
          qualityScore: validationResult?.score,
        };
      }),
    );
  },
});

/** Employee portal: reports due today, upcoming, late, completed, and a simple streak. */
export const myPortal = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .order("desc")
      .take(52);

    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const dueToday = submissions.filter(
      (s) => s.status === "pending" && s.dueAt >= startOfToday.getTime() && s.dueAt <= now + 86400000,
    );
    const upcoming = submissions.filter((s) => s.status === "pending" && s.dueAt > now + 86400000);
    const late = submissions.filter((s) => s.status === "late" || (s.status === "pending" && s.dueAt < now));
    const completed = submissions.filter((s) => s.status === "submitted" || s.status === "late");

    const scored = completed.filter((s) => s.finalScore !== undefined);
    const performanceScore =
      scored.length === 0
        ? null
        : Math.round(scored.reduce((sum, s) => sum + (s.finalScore ?? 0), 0) / scored.length);

    let streak = 0;
    for (const s of [...completed].sort((a, b) => b.dueAt - a.dueAt)) {
      if (s.status === "submitted") streak++;
      else break;
    }

    return { dueToday, upcoming, late, completed, performanceScore, streak };
  },
});

export const myAssignedTemplates = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const assignments = await ctx.db
      .query("reportAssignments")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .collect();
    return await Promise.all(
      assignments.map(async (a) => ({
        assignment: a,
        template: await ctx.db.get(a.templateId),
      })),
    );
  },
});
