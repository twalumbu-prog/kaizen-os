import { v } from "convex/values";
import { query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireProfile } from "./lib/roles";
import { nextPeriod, periodContaining } from "./lib/periods";
import type { PeriodBounds } from "./lib/periods";
import { submissionScore as computeSubmissionScore } from "./lib/scoring";

/**
 * Safety bound on how many of a report's own periods get walked per
 * assignee. Generous enough for a daily report tracked for several years —
 * see accumulate() — while still ruling out a runaway loop.
 */
const PERIOD_GUARD = 2000;

interface UserAgg {
  points: number;
  maxPoints: number;
  onTime: number;
  late: number;
  missing: number;
  dueCount: number;
}

function emptyAgg(): UserAgg {
  return { points: 0, maxPoints: 0, onTime: 0, late: 0, missing: 0, dueCount: 0 };
}

/** The departments a caller may see: admin gets the org, manager their own department, employee the department(s) of what they're assigned. */
async function scopedDepartments(
  ctx: QueryCtx,
  profile: Doc<"profiles">,
): Promise<Doc<"departments">[]> {
  const all = await ctx.db
    .query("departments")
    .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
    .collect();

  if (profile.role === "admin") return all;
  if (profile.role === "manager") return all.filter((d) => d._id === profile.departmentId);

  const myAssignments = await ctx.db
    .query("reportAssignments")
    .withIndex("by_userId", (q) => q.eq("userId", profile.userId))
    .collect();
  const myTemplates = (
    await Promise.all(myAssignments.map((a) => ctx.db.get(a.templateId)))
  ).filter((t): t is Doc<"reportTemplates"> => t !== null);
  const myDepartmentIds = new Set(myTemplates.map((t) => t.departmentId));
  return all.filter((d) => myDepartmentIds.has(d._id));
}

async function templatesInScope(
  ctx: QueryCtx,
  departments: Doc<"departments">[],
): Promise<Doc<"reportTemplates">[]> {
  return (
    await Promise.all(
      departments.map((d) =>
        ctx.db
          .query("reportTemplates")
          .withIndex("by_departmentId", (q) => q.eq("departmentId", d._id))
          .collect(),
      ),
    )
  ).flat();
}

/**
 * Points earned by every assignee of `templates`, for reports due in
 * `[windowFrom, windowTo]`. A report's own schedule (daily, weekly, a school
 * term, ...) decides exactly when it falls due; points are then bucketed into
 * whatever window the caller asks for — a single week, or "all time" — which
 * is what lets the same report cadence serve both leaderboard views.
 *
 * Missing periods are computed live from the template's cadence rather than
 * requiring a "missing" submission row to already exist, so a report the
 * nightly backfill hasn't reached yet still counts against whoever owes it.
 * A period only counts once it has actually fallen due (`dueAt <= now`).
 *
 * The walk covers every period in the window regardless of when the
 * assignment was created — a real submission for a period predating the
 * assignment (someone assigned after the fact, catching up on a past period
 * through the calendar's backdated-submission flow) still counts in their
 * favour. Only the *absence* of a submission is guarded by assignment
 * timing: a period with nothing submitted only counts as "missing" — 0
 * points — if the assignee was actually responsible for it by the time it
 * was due (`dueAt >= their assignment's start`), so nobody is penalised for
 * a deadline that came and went before they joined.
 */
async function accumulate(
  ctx: QueryCtx,
  templates: Doc<"reportTemplates">[],
  windowFrom: number,
  windowTo: number,
): Promise<Map<Id<"users">, UserAgg>> {
  const now = Date.now();
  const agg = new Map<Id<"users">, UserAgg>();

  for (const template of templates) {
    const assignments = await ctx.db
      .query("reportAssignments")
      .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
      .collect();
    if (assignments.length === 0) continue;

    // Every assignee always appears on the board, even with nothing due in
    // this particular window — "0 points, nothing owed" is a real standing.
    for (const assignment of assignments) {
      if (!agg.has(assignment.userId)) agg.set(assignment.userId, emptyAgg());
    }

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
      .order("desc")
      .take(600);

    // Walked once per template, covering the whole window — shared by every
    // assignee, since a period's existence doesn't depend on who's assigned.
    // For "totals" windowFrom is 0 (epoch), which would walk tens of
    // thousands of empty periods for an old daily report before PERIOD_GUARD
    // even reached anything real — so the walk starts no earlier than
    // whichever is earliest: the first assignment, or an actual submission's
    // own period (covering a backdated submission that predates its own
    // assignment, same as Moses Kalunga's case above).
    const walkFrom = Math.max(
      windowFrom,
      Math.min(...assignments.map((a) => a._creationTime), ...submissions.map((s) => s.periodStart)),
    );

    let cursor: PeriodBounds;
    try {
      cursor = periodContaining(template, walkFrom);
      // A period's due date always falls within the *next* period at most
      // (e.g. a monthly report is due sometime in the following calendar
      // month, never later) — so stepping back one period before starting
      // guarantees a period that starts before `walkFrom` but falls due
      // inside the window is never skipped. This matters for narrow windows
      // (a single week): `walkFrom` can land inside, say, September while
      // the period actually due that week is August's, which periodContaining
      // alone would miss entirely. The loop below then skips anything whose
      // due date is still before the window rather than counting it.
      cursor = periodContaining(template, cursor.periodStart - 1);
    } catch {
      // A misconfigured report (e.g. "cycle" cadence with no cycle settings)
      // is skipped rather than failing the whole leaderboard.
      continue;
    }

    let guard = 0;
    while (guard < PERIOD_GUARD) {
      if (cursor.dueAt > windowTo) break;
      if (cursor.dueAt >= windowFrom && cursor.dueAt <= now) {
        for (const assignment of assignments) {
          // A handful of periods can carry duplicate rows from earlier
          // backfill runs (see myReportScores); prefer a real submission
          // over a stray "missing" placeholder when both exist.
          const matches = submissions.filter(
            (s) => s.periodLabel === cursor.periodLabel && s.userId === assignment.userId,
          );
          const submission = matches.find((s) => s.status !== "missing") ?? matches[0];

          // No submission, and the period was due before they were even
          // assigned — not their gap to answer for, skip entirely (doesn't
          // count toward points, maxPoints, or dueCount).
          if (!submission && cursor.dueAt < assignment._creationTime) continue;

          const status = submission?.status ?? "missing";
          const points = computeSubmissionScore({
            status,
            dueAt: cursor.dueAt,
            submittedAt: submission?.submittedAt,
          });

          const entry = agg.get(assignment.userId)!;
          entry.points += points;
          entry.maxPoints += 100;
          entry.dueCount += 1;
          if (status === "submitted") entry.onTime += 1;
          else if (status === "late") entry.late += 1;
          else entry.missing += 1;
        }
      }
      cursor = nextPeriod(template, cursor);
      guard++;
    }
  }

  return agg;
}

interface Standing {
  userId: Id<"users">;
  name: string;
  rank: number;
  points: number;
  maxPoints: number;
  onTime: number;
  late: number;
  missing: number;
  dueCount: number;
}

function toStandings(
  agg: Map<Id<"users">, UserAgg>,
  nameByUserId: Map<Id<"users">, string>,
): Standing[] {
  const rows = Array.from(agg.entries()).map(([userId, a]) => ({
    userId,
    name: nameByUserId.get(userId) ?? "Unknown",
    ...a,
  }));
  rows.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.onTime !== a.onTime) return b.onTime - a.onTime;
    return a.name.localeCompare(b.name);
  });
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Cumulative leaderboard: every point earned since each person's assignments began, through now. */
export const leaderboardTotals = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    const departments = await scopedDepartments(ctx, profile);
    const templates = await templatesInScope(ctx, departments);

    const orgProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    const nameByUserId = new Map(orgProfiles.map((p) => [p.userId, p.name]));

    const agg = await accumulate(ctx, templates, 0, Date.now());

    return { asOf: Date.now(), standings: toStandings(agg, nameByUserId) };
  },
});

/**
 * One week's leaderboard — points earned only by reports due inside that
 * week — plus enough of the surrounding weeks to page through history and
 * see how standings moved. `weekStart` may be any timestamp inside the
 * desired week; it is normalized to that week's Friday-anchored bounds
 * (matching the "weekly" cadence used throughout the app), so the client
 * doesn't need to know the exact boundary math to page forward or back.
 */
export const leaderboardWeek = query({
  args: { weekStart: v.optional(v.number()) },
  handler: async (ctx, { weekStart }) => {
    const profile = await requireProfile(ctx);
    const departments = await scopedDepartments(ctx, profile);
    const templates = await templatesInScope(ctx, departments);

    const orgProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    const nameByUserId = new Map(orgProfiles.map((p) => [p.userId, p.name]));

    const bounds = periodContaining("weekly", weekStart ?? Date.now());
    const previousBounds = periodContaining("weekly", bounds.periodStart - 1);

    const [agg, previousAgg] = await Promise.all([
      accumulate(ctx, templates, bounds.periodStart, bounds.periodEnd),
      accumulate(ctx, templates, previousBounds.periodStart, previousBounds.periodEnd),
    ]);

    const standings = toStandings(agg, nameByUserId);
    const previousRankByUserId = new Map(
      toStandings(previousAgg, nameByUserId).map((s) => [s.userId, s.rank]),
    );

    return {
      weekStart: bounds.periodStart,
      weekEnd: bounds.periodEnd,
      weekLabel: bounds.periodLabel,
      prevWeekStart: previousBounds.periodStart,
      nextWeekStart: nextPeriod("weekly", bounds).periodStart,
      isCurrentWeek: Date.now() >= bounds.periodStart && Date.now() <= bounds.periodEnd,
      standings: standings.map((s) => {
        const previousRank = previousRankByUserId.get(s.userId) ?? null;
        return {
          ...s,
          previousRank,
          // Positive means the person moved up the board since last week.
          rankChange: previousRank === null ? null : previousRank - s.rank,
        };
      }),
    };
  },
});

const DEFAULT_HISTORY_WEEKS = 12;
const MAX_HISTORY_WEEKS = 52;

/**
 * One person's points, week by week, going back from the current week — what
 * a click on a leaderboard row opens to show how their standing built up.
 * Scoped the same as the boards themselves: only returns a week's numbers for
 * templates the *caller* can see, so a manager can't page through an
 * employee's history in a department they don't oversee.
 */
export const leaderboardUserHistory = query({
  args: { userId: v.id("users"), weeks: v.optional(v.number()) },
  handler: async (ctx, { userId, weeks }) => {
    const profile = await requireProfile(ctx);
    const departments = await scopedDepartments(ctx, profile);
    const templates = await templatesInScope(ctx, departments);

    const target = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("orgId"), profile.orgId))
      .first();
    if (!target) return null;

    const weekCount = Math.min(Math.max(weeks ?? DEFAULT_HISTORY_WEEKS, 1), MAX_HISTORY_WEEKS);

    // Walk backward from the current week so the most recent week is always
    // included, however many weeks are asked for.
    const weekBounds: PeriodBounds[] = [];
    let cursor = periodContaining("weekly", Date.now());
    for (let i = 0; i < weekCount; i++) {
      weekBounds.unshift(cursor);
      cursor = periodContaining("weekly", cursor.periodStart - 1);
    }

    const aggs = await Promise.all(
      weekBounds.map((bounds) => accumulate(ctx, templates, bounds.periodStart, bounds.periodEnd)),
    );

    const weeklyEmpty = emptyAgg();
    const history = weekBounds.map((bounds, i) => {
      const a = aggs[i].get(userId) ?? weeklyEmpty;
      return {
        weekStart: bounds.periodStart,
        weekEnd: bounds.periodEnd,
        weekLabel: bounds.periodLabel,
        points: a.points,
        maxPoints: a.maxPoints,
        onTime: a.onTime,
        late: a.late,
        missing: a.missing,
        dueCount: a.dueCount,
      };
    });

    const cumulativePoints = history.reduce((sum, w) => sum + w.points, 0);
    const cumulativeMaxPoints = history.reduce((sum, w) => sum + w.maxPoints, 0);

    return {
      userId,
      name: target.name,
      history,
      cumulativePoints,
      cumulativeMaxPoints,
    };
  },
});
