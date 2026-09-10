import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { CHECKLIST_STATUS, FILE_TYPE } from "./schema";
import { requireProfile } from "./lib/roles";
import { boundsForDueAt, currentPeriod, nextPeriod, periodContaining } from "./lib/periods";
import type { PeriodBounds } from "./lib/periods";
import { finalReportScore, submissionScore as computeSubmissionScore } from "./lib/scoring";
import { getMaxPossibleScore } from "./validators/registry";

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
    anchorEnd = periodContaining(template, assignment._creationTime).periodEnd;
  }

  const existingLabels = new Set(mine.map((s) => s.periodLabel));
  let cursor = nextPeriod(template, periodContaining(template, anchorEnd));
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
    cursor = nextPeriod(template, cursor);
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
      .sort((a, b) => {
        // Sort by periodEnd descending
        if (b.periodEnd !== a.periodEnd) {
          return b.periodEnd - a.periodEnd;
        }
        // If there are multiple submissions for the same period (e.g. from different users or duplicates),
        // prefer the current user's submission.
        if (b.userId === submission.userId && a.userId !== submission.userId) return 1;
        if (a.userId === submission.userId && b.userId !== submission.userId) return -1;
        // Otherwise, prefer the submission with the highest score
        return (b.finalScore ?? 0) - (a.finalScore ?? 0);
      })[0];
    const expectedOpeningBalance = prior?.bankClosingBalance ?? template.startingBalance ?? null;

    // The org owns the AI integration the validator may need, and is reached
    // through the template's department.
    const department = await ctx.db.get(template.departmentId);

    return {
      submission,
      template,
      files,
      expectedOpeningBalance,
      orgId: department?.orgId ?? null,
    };
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

    return getOrCreateSubmissionForBounds(ctx, template, profile.userId, currentPeriod(template));
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

    const bounds = boundsForDueAt(template, dueAt);
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
        try {
          const inserted = await backfillMissingPeriods(ctx, template, assignment.userId);
          anyInserted = anyInserted || inserted;
        } catch (err) {
          // A misconfigured report (e.g. "cycle" cadence with no cycle settings)
          // must not stop the nightly sweep for every other report.
          console.error(
            `[backfill] Skipped "${template.name}" (${template._id}):`,
            err instanceof Error ? err.message : err,
          );
        }
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

export const replaceSubmissionFile = mutation({
  args: {
    fileId: v.id("submissionFiles"),
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  handler: async (ctx, { fileId, storageId, fileName }) => {
    const profile = await requireProfile(ctx);
    const file = await ctx.db.get(fileId);
    if (!file) throw new Error("File not found");

    const submission = await ctx.db.get(file.submissionId);
    if (!submission) throw new Error("Submission not found");
    if (submission.userId !== profile.userId && profile.role === "employee") {
      throw new Error("You can only replace your own reports");
    }

    // Optionally delete old storage ID here.
    // await ctx.storage.delete(file.storageId);

    await ctx.db.patch(fileId, { storageId, fileName });

    // Mark as submitted/late and re-evaluate score
    const now = Date.now();
    const status = now <= submission.dueAt ? "submitted" : "late";
    const subScore = computeSubmissionScore({ status, dueAt: submission.dueAt, submittedAt: now });
    await ctx.db.patch(submission._id, { submittedAt: now, status, submissionScore: subScore });

    await ctx.scheduler.runAfter(0, internal.validationRunner.runValidation, { submissionId: submission._id });
    return null;
  },
});

export const deleteSubmissionFile = mutation({
  args: {
    fileId: v.id("submissionFiles"),
  },
  handler: async (ctx, { fileId }) => {
    const profile = await requireProfile(ctx);
    const file = await ctx.db.get(fileId);
    if (!file) throw new Error("File not found");

    const submission = await ctx.db.get(file.submissionId);
    if (!submission) throw new Error("Submission not found");
    if (submission.userId !== profile.userId && profile.role === "employee") {
      throw new Error("You can only delete files from your own reports");
    }

    // Delete the file record
    await ctx.db.delete(fileId);

    // If no files remain, reset submission to pending? 
    // Actually, we can just trigger validation, which will mark it as missing files.
    // Or we reset to pending if we want them to start from scratch.
    // Let's just trigger validation so it fails and they can see it's missing.
    const now = Date.now();
    const status = now <= submission.dueAt ? "submitted" : "late";
    const subScore = computeSubmissionScore({ status, dueAt: submission.dueAt, submittedAt: now });
    await ctx.db.patch(submission._id, { submittedAt: now, status, submissionScore: subScore });

    await ctx.scheduler.runAfter(0, internal.validationRunner.runValidation, { submissionId: submission._id });
    return null;
  },
});

/**
 * Creates (or replaces) a daily submission and marks it submitted.
 * Called by the ad-reports auto-submit cron — bypasses user-auth checks.
 */
export const autoSubmitInternal = internalMutation({
  args: {
    templateId:  v.id("reportTemplates"),
    userId:      v.id("users"),
    storageId:   v.id("_storage"),
    fileName:    v.string(),
    fileLabel:   v.string(),
    periodLabel: v.string(),
    periodStart: v.number(),
    periodEnd:   v.number(),
    dueAt:       v.number(),
  },
  handler: async (ctx, args) => {
    // Find an existing submission for this user/template/period.
    const existing = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", args.templateId))
      .filter((q) =>
        q.and(
          q.eq(q.field("userId"), args.userId),
          q.eq(q.field("periodLabel"), args.periodLabel),
        ),
      )
      .unique();

    let submissionId: Id<"submissions">;
    if (existing) {
      submissionId = existing._id;
      // Replace all previously attached files for this submission.
      const old = await ctx.db
        .query("submissionFiles")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId))
        .collect();
      for (const f of old) await ctx.db.delete(f._id);
    } else {
      submissionId = await ctx.db.insert("submissions", {
        templateId:    args.templateId,
        userId:        args.userId,
        periodLabel:   args.periodLabel,
        periodStart:   args.periodStart,
        periodEnd:     args.periodEnd,
        dueAt:         args.dueAt,
        status:        "pending",
        isAutoSubmitted: true,
      });
    }

    await ctx.db.insert("submissionFiles", {
      submissionId,
      storageId: args.storageId,
      label:     args.fileLabel,
      fileType:  "xlsx",
      fileName:  args.fileName,
    });

    const now = Date.now();
    const status = now <= args.dueAt ? "submitted" : "late";
    const subScore = computeSubmissionScore({ status, dueAt: args.dueAt, submittedAt: now });
    await ctx.db.patch(submissionId, { submittedAt: now, status, submissionScore: subScore });

    await ctx.scheduler.runAfter(0, internal.validationRunner.runValidation, { submissionId });
    return submissionId;
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
    const profile = await requireProfile(ctx);
    const submission = await ctx.db.get(submissionId);
    if (!submission) return null;
    
    const template = await ctx.db.get(submission.templateId);
    if (template) {
      const dept = await ctx.db.get(template.departmentId);
      if (!dept || dept.orgId !== profile.orgId) throw new Error("Unauthorized");
    }

    const [employee, files, validationResult] = await Promise.all([
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
      employeeName: submission.isAutoSubmitted ? "System" : employee && "name" in employee ? employee.name : undefined,
      files: fileUrls,
      validationResult,
      checklist,
    };
  },
});

export const listSubmissionsForTemplate = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const profile = await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (template) {
      const dept = await ctx.db.get(template.departmentId);
      if (!dept || dept.orgId !== profile.orgId) throw new Error("Unauthorized");
    }
    
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
          employeeName: s.isAutoSubmitted ? "System" : employee && "name" in employee ? employee.name : "Unknown",
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
/**
 * Widest range a single call may request. Covers the full-month dialog grid
 * (max 6 weeks = 42 days) and the Reports tab strip, which grows this range
 * as the employee scrolls — capped well short of this so it never errors.
 */
const MAX_CALENDAR_RANGE_DAYS = 370;

/**
 * What's due each day across an arbitrary date range, for the Reports tab's
 * calendar strip (defaults to a ~3-week window around today) and the full
 * calendar dialog (a month at a time, freely navigable).
 */
/**
 * The day-by-day calendar behind the Work Calendar's list view.
 *
 * Scope follows the caller's role. An employee sees only the reports assigned
 * to them; a manager sees every report in their department and a admin sees
 * the whole organization, with one entry per person responsible so they can
 * see who still owes what. Entries for other people carry `assigneeName`,
 * which is what the UI keys off to show status rather than a submit button.
 */
export const myCalendar = query({
  args: { from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const profile = await requireProfile(ctx);
    const overseeing = profile.role === "admin" || profile.role === "manager";

    // ── Reports in scope, with everyone responsible for them ───────────────
    const orgProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    const nameByUserId = new Map(orgProfiles.map((p) => [p.userId, p.name]));

    let templates: Doc<"reportTemplates">[];
    if (overseeing) {
      const departments = await ctx.db
        .query("departments")
        .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
        .collect();
      const inScope =
        profile.role === "manager"
          ? departments.filter((d) => d._id === profile.departmentId)
          : departments;
      templates = (
        await Promise.all(
          inScope.map((d) =>
            ctx.db
              .query("reportTemplates")
              .withIndex("by_departmentId", (q) => q.eq("departmentId", d._id))
              .collect(),
          ),
        )
      ).flat();
    } else {
      const assignments = await ctx.db
        .query("reportAssignments")
        .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
        .collect();
      templates = (await Promise.all(assignments.map((a) => ctx.db.get(a.templateId)))).filter(
        (t): t is Doc<"reportTemplates"> => t !== null,
      );
    }

    // Who owes each report, and everything already submitted against it.
    const owners = new Map<Id<"reportTemplates">, Id<"users">[]>();
    const submissionsByTemplate = new Map<Id<"reportTemplates">, Doc<"submissions">[]>();
    for (const template of templates) {
      if (overseeing) {
        const assignments = await ctx.db
          .query("reportAssignments")
          .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
          .collect();
        owners.set(template._id, assignments.map((a) => a.userId));
        submissionsByTemplate.set(
          template._id,
          await ctx.db
            .query("submissions")
            .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
            .order("desc")
            .take(600),
        );
      } else {
        owners.set(template._id, [profile.userId]);
      }
    }

    if (!overseeing) {
      const mine = await ctx.db
        .query("submissions")
        .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
        .order("desc")
        .take(400);
      for (const template of templates) {
        submissionsByTemplate.set(
          template._id,
          mine.filter((s) => s.templateId === template._id),
        );
      }
    }

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
        // A misconfigured report is skipped rather than blanking the calendar.
        let bounds: PeriodBounds;
        try {
          bounds = boundsForDueAt(template, day.getTime());
        } catch {
          continue;
        }
        if (new Date(bounds.dueAt).toISOString().slice(0, 10) !== dayKey) continue;

        const periodSubmissions = (submissionsByTemplate.get(template._id) ?? []).filter(
          (s) => s.periodLabel === bounds.periodLabel,
        );
        const responsible = owners.get(template._id) ?? [];

        // One row per person who owes the report, so nobody's gap is hidden
        // behind a colleague who did submit.
        const rows: { userId: Id<"users"> | null }[] =
          responsible.length > 0 ? responsible.map((userId) => ({ userId })) : [{ userId: null }];

        for (const row of rows) {
          // For unassigned rows, still surface any auto-submitted report for the period.
          const submission = row.userId
            ? periodSubmissions.find((s) => s.userId === row.userId)
            : periodSubmissions.find((s) => s.isAutoSubmitted) ?? undefined;
          items.push({
            templateId: template._id,
            templateName: template.name,
            periodLabel: bounds.periodLabel,
            dueAt: bounds.dueAt,
            submissionId: submission?._id ?? null,
            status: submission?.status ?? (row.userId ? "pending" : "unassigned"),
            completed: submission?.status === "submitted" || submission?.status === "late",
            score: submission?.finalScore ?? null,
            /** Set only when overseeing someone else's report — drives read-only UI. */
            assigneeName:
              overseeing && row.userId ? (nameByUserId.get(row.userId) ?? "Unknown") : null,
            unassigned: row.userId === null && !submission,
          });
        }
      }

      days.push({ date: day.getTime(), items });
    }

    return days;
  },
});

const SCORE_PERIOD_GUARD = 400;

/**
 * YTD checklist score per assigned report template: every period due so far
 * this calendar year, its individual earned/possible checklist points (from
 * the persisted validation result when one exists, else the current rules'
 * max), rolled up into a cumulative score for the Score tab.
 */
export const myReportScores = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const assignments = await ctx.db
      .query("reportAssignments")
      .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
      .collect();
    const templates = (await Promise.all(assignments.map((a) => ctx.db.get(a.templateId)))).filter(
      (t): t is Doc<"reportTemplates"> => t !== null,
    );

    const now = Date.now();
    const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1);

    return await Promise.all(
      templates.map(async (template) => {
        const ytdPeriods: PeriodBounds[] = [];
        let cursor = periodContaining(template, yearStart);
        let guard = 0;
        while (cursor.dueAt <= now && guard < SCORE_PERIOD_GUARD) {
          ytdPeriods.push(cursor);
          cursor = nextPeriod(template, cursor);
          guard++;
        }

        const periods = await Promise.all(
          ytdPeriods.map(async (bounds) => {
            // Uses .collect() + pick rather than .unique(): a handful of periods have
            // duplicate rows for the same (template, period, user) from earlier backfill
            // runs, which would otherwise throw here. Prefer a non-"missing" row when both exist.
            const matches = await ctx.db
              .query("submissions")
              .withIndex("by_templateId_periodLabel", (q) =>
                q.eq("templateId", template._id).eq("periodLabel", bounds.periodLabel),
              )
              .filter((q) => q.eq(q.field("userId"), profile.userId))
              .collect();
            const submission = matches.find((s) => s.status !== "missing") ?? matches[0];

            let earned = 0;
            let possible = getMaxPossibleScore(template.validatorKey, template.validationRules);
            let checklist: Doc<"validationChecklistItems">[] = [];

            if (submission) {
              const validationResult = await ctx.db
                .query("validationResults")
                .withIndex("by_submissionId", (q) => q.eq("submissionId", submission._id))
                .order("desc")
                .first();
              if (validationResult) {
                checklist = await ctx.db
                  .query("validationChecklistItems")
                  .withIndex("by_validationResultId", (q) => q.eq("validationResultId", validationResult._id))
                  .collect();
                earned = checklist.reduce((sum, c) => sum + c.points, 0);
                possible = checklist.reduce((sum, c) => sum + c.maxPoints, 0);
              }
            }

            return {
              periodLabel: bounds.periodLabel,
              periodStart: bounds.periodStart,
              periodEnd: bounds.periodEnd,
              dueAt: bounds.dueAt,
              status: submission?.status ?? "missing",
              submissionId: submission?._id ?? null,
              earned,
              possible,
              checklist,
            };
          }),
        );

        periods.sort((a, b) => b.dueAt - a.dueAt);

        const earned = periods.reduce((sum, p) => sum + p.earned, 0);
        const possible = periods.reduce((sum, p) => sum + p.possible, 0);
        const dept = await ctx.db.get(template.departmentId);

        return {
          templateId: template._id,
          templateName: template.name,
          departmentId: template.departmentId,
          departmentName: dept?.name ?? "Unknown",
          earned,
          possible,
          periods,
        };
      }),
    );
  },
});

// ─── Timeline ─────────────────────────────────────────────────────────────────

/** How each report's due date looks once every assignee is accounted for. */
type DueState = "complete" | "partial" | "overdue" | "upcoming" | "unassigned";

/**
 * Every report due inside a date window, grouped by department — the data
 * behind the Work Calendar's Timeline view.
 *
 * Scope follows the caller's role: an admin oversees the whole organization, a
 * manager their own department, and an employee only what they are assigned.
 * Due dates come from the same cadence engine the rest of the app uses, so a
 * report that has never been submitted still appears on the days it is owed.
 */
export const reportTimeline = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from: rawFrom, to: rawTo }) => {
    const profile = await requireProfile(ctx);

    const from = new Date(rawFrom);
    from.setUTCHours(0, 0, 0, 0);
    const to = new Date(rawTo);
    to.setUTCHours(23, 59, 59, 999);

    const totalDays = Math.round((to.getTime() - from.getTime()) / 86400000);
    if (totalDays < 1 || totalDays > MAX_CALENDAR_RANGE_DAYS) {
      throw new Error(`Timeline range must be between 1 and ${MAX_CALENDAR_RANGE_DAYS} days`);
    }

    // ── Which departments and reports the caller may see ────────────────────
    const allDepartments = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();

    let departments = allDepartments;
    if (profile.role === "manager") {
      departments = allDepartments.filter((d) => d._id === profile.departmentId);
    } else if (profile.role === "employee") {
      const myAssignments = await ctx.db
        .query("reportAssignments")
        .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
        .collect();
      const myTemplates = (
        await Promise.all(myAssignments.map((a) => ctx.db.get(a.templateId)))
      ).filter((t): t is Doc<"reportTemplates"> => t !== null);
      const myDepartmentIds = new Set(myTemplates.map((t) => t.departmentId));
      departments = allDepartments.filter((d) => myDepartmentIds.has(d._id));
    }

    const visibleToEmployee =
      profile.role === "employee"
        ? new Set(
            (
              await ctx.db
                .query("reportAssignments")
                .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
                .collect()
            ).map((a) => a.templateId),
          )
        : null;

    const now = Date.now();
    const groups = [];

    for (const department of departments) {
      const templates = await ctx.db
        .query("reportTemplates")
        .withIndex("by_departmentId", (q) => q.eq("departmentId", department._id))
        .collect();

      const reports = [];
      for (const template of templates) {
        if (visibleToEmployee && !visibleToEmployee.has(template._id)) continue;

        const assignments = await ctx.db
          .query("reportAssignments")
          .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
          .collect();
        const assigneeIds = assignments.map((a) => a.userId);

        const submissions = await ctx.db
          .query("submissions")
          .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
          .order("desc")
          .take(600);

        // Walk the report's own periods across the window. A misconfigured
        // report (e.g. "cycle" with no settings) is skipped, not fatal.
        const due = [];
        try {
          let cursor = periodContaining(template, from.getTime());
          let guard = 0;
          while (cursor.dueAt <= to.getTime() && guard < MAX_CALENDAR_RANGE_DAYS + 10) {
            if (cursor.dueAt >= from.getTime()) {
              const forPeriod = submissions.filter((s) => s.periodLabel === cursor.periodLabel);
              const done = forPeriod.filter(
                (s) => s.status === "submitted" || s.status === "late",
              );

              let state: DueState;
              if (assigneeIds.length === 0) {
                state = "unassigned";
              } else if (done.length >= assigneeIds.length) {
                state = "complete";
              } else if (done.length > 0) {
                state = "partial";
              } else if (cursor.dueAt < now) {
                state = "overdue";
              } else {
                state = "upcoming";
              }

              due.push({
                dueAt: cursor.dueAt,
                /** UTC midnight of the due day — the timeline's column key. */
                day: Date.parse(`${new Date(cursor.dueAt).toISOString().slice(0, 10)}T00:00:00Z`),
                periodLabel: cursor.periodLabel,
                state,
                submitted: done.length,
                expected: assigneeIds.length,
              });
            }
            cursor = nextPeriod(template, cursor);
            guard++;
          }
        } catch {
          // Leave `due` empty for a report whose schedule cannot be computed.
        }

        reports.push({
          templateId: template._id,
          name: template.name,
          cadence: template.cadence,
          assigneeCount: assigneeIds.length,
          due,
        });
      }

      if (reports.length === 0) continue;
      groups.push({
        departmentId: department._id,
        departmentName: department.name,
        reports: reports.sort((a, b) => a.name.localeCompare(b.name)),
      });
    }

    return {
      role: profile.role,
      from: from.getTime(),
      to: to.getTime(),
      departments: groups.sort((a, b) => a.departmentName.localeCompare(b.departmentName)),
    };
  },
});
