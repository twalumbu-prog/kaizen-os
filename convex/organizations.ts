import { query } from "./_generated/server";
import { requireProfile } from "./lib/roles";

/** Phase 1 only supports a single organization, so this returns the only one. */
export const getPrimary = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    return await ctx.db.get(profile.orgId);
  },
});
