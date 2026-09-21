import { internalMutation } from "./_generated/server";

/**
 * Removes duplicate submission rows that a race in the old
 * `backfillMissingPeriods` could create for a shared report — two assignees
 * opening the report around the same moment could each independently decide
 * a period had no submission yet and insert their own "missing" placeholder
 * for it. A shared report should have exactly one row per period.
 *
 * For each (template, period) with more than one row, keeps a real
 * submitted/late row over a missing/pending one (earliest on a tie) and
 * deletes the rest — but only when the row being removed has no files
 * attached, so a duplicate carrying real uploaded work is left for manual
 * review instead of silently discarded.
 *
 * Run with: npx convex run fixDuplicateMissingSubmissions:run
 */
export const run = internalMutation({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("reportTemplates").collect();
    const removed: string[] = [];
    const skipped: string[] = [];

    for (const template of templates) {
      if (template.sharingMode !== "shared") continue;

      const submissions = await ctx.db
        .query("submissions")
        .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
        .collect();

      const byPeriod = new Map<string, typeof submissions>();
      for (const s of submissions) {
        const list = byPeriod.get(s.periodLabel) ?? [];
        list.push(s);
        byPeriod.set(s.periodLabel, list);
      }

      for (const [periodLabel, group] of byPeriod) {
        if (group.length <= 1) continue;

        const rank = (s: (typeof group)[number]) =>
          s.status === "submitted" || s.status === "late" ? 0 : s.status === "pending" ? 1 : 2;
        const keep = [...group].sort(
          (a, b) => rank(a) - rank(b) || a._creationTime - b._creationTime,
        )[0];

        for (const s of group) {
          if (s._id === keep._id) continue;

          const files = await ctx.db
            .query("submissionFiles")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
            .collect();
          if (files.length > 0) {
            skipped.push(
              `${template.name} / ${periodLabel}: left ${s.status} duplicate ${s._id} (has files)`,
            );
            continue;
          }

          await ctx.db.delete(s._id);
          removed.push(`${template.name} / ${periodLabel}: removed ${s.status} duplicate ${s._id}`);
        }
      }
    }

    return { removed, skipped };
  },
});
