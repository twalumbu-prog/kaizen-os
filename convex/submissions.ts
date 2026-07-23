import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { CHECKLIST_STATUS, FILE_TYPE } from "./schema";
import { requireProfile } from "./lib/roles";
import { currentPeriod, nextPeriod, periodContaining } from "./lib/periods";
import type { Cadence, PeriodBounds } from "./lib/periods";
import { finalReportScore, submissionScore as computeSubmissionScore } from "./lib/scoring";

/**
 * Walks forward from the caller's most recent submission (or, if they have
 * none yet, from when they were assigned the report) inserting `"missing"`
 * rows for any period whose due date has already passed with nothing
 * submitted. Called both lazily (when an employee opens the upload page) and
 * proactively (daily cron in convex/crons.ts) so gaps surface either way.
 */
async function backfillMissingPeriods(
  ctx: MutationCtx,
  template: Doc<"reportTemplates">,
  userId: Id<"users">,
): Promise<boolean> {
  const existing = await ctx.db
    .query("submissions")
    .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
    .order("desc")
    .take(400);
  const mine = existing.filter((s) => s.userId === userId);

  let anchorEnd: number;
  if (mine.length > 0) {
    anchorEnd = Math.max(...mine.map((s) => s.periodEnd));
  } else {
    const assignment = await ctx.db
      .query("reportAssignments")
      .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
      .filter((q) => q.eq(q.field("userId"), userId))
      .unique();
    if (!assignment) return false; // not assigned, nothing to backfill
    anchorEnd = periodContaining(template.cadence, assignment._creationTime).periodEnd;
  }

  const existingLabels = new Set(mine.map((s) => s.periodLabel));
  let cursor = nextPeriod(template.cadence, periodContaining(template.cadence, anchorEnd));
  const now = Date.now();
  let inserted = false;
  let guard = 0;

  while (cursor.dueAt < now && guard < 366) {
    if (!existingLabels.has(cursor.periodLabel)) {
      await ctx.db.insert("submissions", {
        templateId: template._id,
        userId,
        periodLabel: cursor.periodLabel,
        periodStart: cursor.periodStart,
        periodEnd: cursor.periodEnd,
        dueAt: cursor.dueAt,
        status: "missing",
      });
      inserted = true;
    }
    cursor = nextPeriod(template.cadence, cursor);
    guard++;
  }

  return inserted;
}

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

    // Expected opening balance rolls forward from the most recent prior
    // period (for this report, any employee) that has a validated closing
    // balance recorded — this naturally skips over "missing" gap periods,
    // which never have one. Falls back to the admin-seeded starting balance
    // for the very first period.
    const priorSubmissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", submission.templateId))
      .order("desc")
      .take(400);
    const prior = priorSubmissions
      .filter(
        (s) =>
          s._id !== submissionId &&
          s.periodEnd < submission.periodStart &&
          s.bankClosingBalance !== undefined,
      )
      .sort((a, b) => b.periodEnd - a.periodEnd)[0];
    const expectedOpeningBalance = prior?.bankClosingBalance ?? template.startingBalance ?? null;

    return { submission, template, files, expectedOpeningBalance };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireProfile(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Finds this user's existing submission for `bounds`' period, or creates a pending one. */
async function getOrCreateSubmissionForBounds(
  ctx: MutationCtx,
  template: Doc<"reportTemplates">,
  userId: Id<"users">,
  bounds: PeriodBounds,
): Promise<Id<"submissions">> {
  const existing = await ctx.db
    .query("submissions")
    .withIndex("by_templateId_periodLabel", (q) =>
      q.eq("templateId", template._id).eq("periodLabel", bounds.periodLabel),
    )
    .filter((q) => q.eq(q.field("userId"), userId))
    .unique();
  if (existing) return existing._id;

  return await ctx.db.insert("submissions", {
    templateId: template._id,
    userId,
    periodLabel: bounds.periodLabel,
    periodStart: bounds.periodStart,
    periodEnd: bounds.periodEnd,
    dueAt: bounds.dueAt,
    status: "pending",
  });
}

/**
 * Recovers the exact period bounds that produced a given `dueAt`. Since
 * `dueAt` is always `periodEnd + 1 day` (see convex/lib/periods.ts), probing
 * the day before `dueAt` lands back in the same period every time — this is
 * what lets a calendar hand back a due timestamp and get the right period.
 */
function boundsForDueAt(cadence: Cadence, dueAt: number): PeriodBounds {
  const probe = new Date(dueAt);
  probe.setUTCDate(probe.getUTCDate() - 1);
  probe.setUTCHours(12, 0, 0, 0);
  return periodContaining(cadence, probe.getTime());
}

/** Ensures a submission row exists for the current period, for the calling user. */
export const getOrCreateCurrentSubmission = mutation({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const profile = await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Report template not found");

    const inserted = await backfillMissingPeriods(ctx, template, profile.userId);
    if (inserted) {
      await ctx.scheduler.runAfter(0, internal.scores.recomputeDepartmentScore, {
        departmentId: template.departmentId,
      });
    }

    return getOrCreateSubmissionForBounds(ctx, template, profile.userId, currentPeriod(template.cadence));
  },
});

/** Same as getOrCreateCurrentSubmission, but for an arbitrary (past or future) due date — used by the calendar. */
export const getOrCreateSubmissionForDueDate = mutation({
  args: { templateId: v.id("reportTemplates"), dueAt: v.number() },
  handler: async (ctx, { templateId, dueAt }) => {
    const profile = await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Report template not found");

    const inserted = await backfillMissingPeriods(ctx, template, profile.userId);
    if (inserted) {
      await ctx.scheduler.runAfter(0, internal.scores.recomputeDepartmentScore, {
        departmentId: template.departmentId,
      });
    }

    const bounds = boundsForDueAt(template.cadence, dueAt);
    return getOrCreateSubmissionForBounds(ctx, template, profile.userId, bounds);
  },
});

/** Proactive gap detection: runs daily via convex/crons.ts across every assignment. */
export const backfillAllMissingSubmissions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("reportTemplates").collect();
    for (const template of templates) {
      const assignments = await ctx.db
        .query("reportAssignments")
        .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
        .collect();
      let anyInserted = false;
      for (const assignment of assignments) {
        const inserted = await backfillMissingPeriods(ctx, template, assignment.userId);
        anyInserted = anyInserted || inserted;
      }
      if (anyInserted) {
        await ctx.scheduler.runAfter(0, internal.scores.recomputeDepartmentScore, {
          departmentId: template.departmentId,
        });
      }
    }
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
    bankClosingBalance: v.optional(v.number()),
  },
  handler: async (ctx, { submissionId, score, summary, checklist, bankClosingBalance }) => {
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
    await ctx.db.patch(submissionId, { finalScore, bankClosingBalance });

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

    const history = await Promise.all(
      completed
        .sort((a, b) => (b.submittedAt ?? b.dueAt) - (a.submittedAt ?? a.dueAt))
        .map(async (s) => {
          const [template, files] = await Promise.all([
            ctx.db.get(s.templateId),
            ctx.db
              .query("submissionFiles")
              .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
              .collect(),
          ]);
          return {
            submission: s,
            templateName: template?.name ?? "Unknown report",
            fileCount: files.length,
          };
        }),
    );

    return { dueToday, upcoming, late, completed, performanceScore, streak, history };
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

const CALENDAR_DAYS_BEFORE = 10;
const CALENDAR_DAYS_AFTER = 10;
/** Widest range a single call may request — enough for a padded month grid (max 6 weeks = 42 days). */
const MAX_CALENDAR_RANGE_DAYS = 62;

/**
 * What's due each day across an arbitrary date range, for the Reports tab's
 * calendar strip (defaults to a ~3-week window around today) and the full
 * calendar dialog (a month at a time, freely navigable).
 */
export const myCalendar = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const assignments = await ctx.db
      .query("reportAssignments")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .collect();
    const templates = (await Promise.all(assignments.map((a) => ctx.db.get(a.templateId)))).filter(
      (t): t is Doc<"reportTemplates"> => t !== null,
    );

    const mySubmissions = await ctx.db
      .query("submissions")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .order("desc")
      .take(400);

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const defaultFrom = new Date(today);
    defaultFrom.setUTCDate(defaultFrom.getUTCDate() - CALENDAR_DAYS_BEFORE);
    const defaultTo = new Date(today);
    defaultTo.setUTCDate(defaultTo.getUTCDate() + CALENDAR_DAYS_AFTER);

    const from = new Date(args.from ?? defaultFrom.getTime());
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(args.to ?? defaultTo.getTime());
    to.setUTCHours(0, 0, 0, 0);

    const totalDays = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
    if (totalDays < 1 || totalDays > MAX_CALENDAR_RANGE_DAYS) {
      throw new Error(`Calendar range must be between 1 and ${MAX_CALENDAR_RANGE_DAYS} days`);
    }

    const days = [];
    for (let offset = 0; offset < totalDays; offset++) {
      const day = new Date(from);
      day.setUTCDate(day.getUTCDate() + offset);
      const dayKey = day.toISOString().slice(0, 10);

      const items = [];
      for (const template of templates) {
        // `day` (UTC midnight) is itself a valid candidate `dueAt` timestamp to probe with.
        const bounds = boundsForDueAt(template.cadence, day.getTime());
        if (new Date(bounds.dueAt).toISOString().slice(0, 10) !== dayKey) continue;

        const submission = mySubmissions.find(
          (s) => s.templateId === template._id && s.periodLabel === bounds.periodLabel,
        );
        items.push({
          templateId: template._id,
          templateName: template.name,
          periodLabel: bounds.periodLabel,
          dueAt: bounds.dueAt,
          submissionId: submission?._id ?? null,
          status: submission?.status ?? "pending",
          completed: submission?.status === "submitted" || submission?.status === "late",
        });
      }

      days.push({ date: day.getTime(), items });
    }

    return days;
  },
});
