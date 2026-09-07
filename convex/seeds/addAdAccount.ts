import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const run = internalMutation({
  args: {
    orgId: v.id("organizations"),
    adAccountId: v.string(),
  },
  handler: async (ctx, { orgId, adAccountId }) => {
    const integration = await ctx.db
      .query("integrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", orgId).eq("provider", "meta"),
      )
      .filter((q) => q.eq(q.field("status"), "active"))
      .first();

    if (!integration) throw new Error("No active Meta integration found for this org.");

    const cfg = JSON.parse(integration.config ?? "{}") as {
      adAccountId?: string;
      adAccountIds?: string[];
      [k: string]: unknown;
    };

    // Normalise to act_ prefix.
    const normalised = adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;

    // Build deduplicated list that includes both the existing singular field and the new one.
    const existing = [
      ...(cfg.adAccountIds ?? []),
      ...(cfg.adAccountId ? [cfg.adAccountId] : []),
    ].map((id) => (id.startsWith("act_") ? id : `act_${id}`));
    const ids = [...new Set([...existing, normalised])];

    await ctx.db.patch(integration._id, {
      config: JSON.stringify({ ...cfg, adAccountIds: ids }),
    });

    console.log(`Updated Meta integration — adAccountIds: ${ids.join(", ")}`);
  },
});
