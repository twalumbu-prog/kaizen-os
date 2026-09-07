import { internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

export interface AdReportTarget {
  orgId: Id<"organizations">;
  templateId: Id<"reportTemplates">;
  userId: Id<"users">;
  accessToken: string;
  /** Explicit ad account IDs from the integration config (in addition to auto-discovery). */
  adAccountIds: string[];
  template: { cadence: string; [k: string]: unknown };
}

export const findTargets = internalQuery({
  args: {},
  handler: async (ctx): Promise<AdReportTarget[]> => {
    const integrations = await ctx.db
      .query("integrations")
      .filter((q) =>
        q.and(
          q.eq(q.field("provider"), "meta"),
          q.eq(q.field("status"), "active"),
        ),
      )
      .collect();

    const targets: AdReportTarget[] = [];

    for (const integration of integrations) {
      if (!integration.config) continue;
      const cfg = JSON.parse(integration.config) as {
        accessToken?: string;
        adAccountId?: string;
        adAccountIds?: string[];
      };
      if (!cfg.accessToken) continue;

      const departments = await ctx.db
        .query("departments")
        .withIndex("by_orgId", (q) => q.eq("orgId", integration.orgId))
        .collect();

      for (const dept of departments) {
        const templates = await ctx.db
          .query("reportTemplates")
          .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
          .filter((q) => q.eq(q.field("validatorKey"), "adPerformance"))
          .collect();

        for (const template of templates) {
          const admin = await ctx.db
            .query("profiles")
            .withIndex("by_orgId", (q) => q.eq("orgId", integration.orgId))
            .filter((q) => q.eq(q.field("role"), "admin"))
            .first();
          if (!admin) continue;

          // Collect all explicitly configured account IDs (support both singular and array forms), deduped.
          const explicitIds = [...new Set(
            [
              ...(cfg.adAccountIds ?? []),
              ...(cfg.adAccountId ? [cfg.adAccountId] : []),
            ].map((id) => (id.startsWith("act_") ? id : `act_${id}`))
          )];

          targets.push({
            orgId:        integration.orgId,
            templateId:   template._id,
            userId:       admin.userId,
            accessToken:  cfg.accessToken!,
            adAccountIds: explicitIds,
            template:     template as unknown as { cadence: string; [k: string]: unknown },
          });
        }
      }
    }

    return targets;
  },
});
