import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/roles";

/** Returns the currently active organization for the authenticated user. */
export const getPrimary = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    try {
      const profile = await requireProfile(ctx);
      return await ctx.db.get(profile.orgId);
    } catch {
      return null;
    }
  },
});

/** Returns all organizations the authenticated user belongs to. */
export const listMyOrgs = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    const orgs = await Promise.all(profiles.map((p) => ctx.db.get(p.orgId)));
    return orgs
      .filter((o): o is NonNullable<typeof o> => o !== null)
      .map((org) => {
        const profile = profiles.find((p) => p.orgId === org._id)!;
        return { ...org, role: profile.role };
      });
  },
});

/** Sets the active organization for the current user. */
export const switchOrg = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    // Verify the user actually belongs to the target org.
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .unique();
    if (profile === null) throw new Error("Not a member of that organization");

    await ctx.db.patch(userId, { selectedOrgId: orgId });
  },
});
