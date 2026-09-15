import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfile } from "./lib/roles";
import type { Id } from "./_generated/dataModel";

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

/** Creates a new organization for the authenticated user and makes them admin. */
export const createOrg = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User record not found");

    const trimmedName = name.trim();
    if (!trimmedName) throw new Error("Organization name is required");

    const orgId = await ctx.db.insert("organizations", { name: trimmedName });

    await ctx.db.insert("profiles", {
      userId,
      orgId,
      role: "admin",
      name: user.name ?? user.email ?? "User",
    });

    await ctx.db.patch(userId, { selectedOrgId: orgId });
    return orgId;
  },
});

/** Joins an organization via an invite code (orgId or org name) for the authenticated user. */
export const joinOrgByInviteCode = mutation({
  args: { inviteCode: v.string() },
  handler: async (ctx, { inviteCode }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not authenticated");

    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User record not found");

    const trimmedCode = inviteCode.trim();
    if (!trimmedCode) throw new Error("Invite code is required");

    // 1. Try to find org by ID
    let orgId: Id<"organizations"> | null = null;
    const normalizedId = await ctx.db.normalizeId("organizations", trimmedCode);
    if (normalizedId) {
      const org = await ctx.db.get(normalizedId);
      if (org) orgId = org._id;
    }

    // 2. Try to find org by Name
    if (!orgId) {
      const orgByName = await ctx.db
        .query("organizations")
        .filter((q) => q.eq(q.field("name"), trimmedCode))
        .first();
      if (orgByName) orgId = orgByName._id;
    }

    if (!orgId) {
      throw new Error("Organization not found for that invite code");
    }

    // Check if user already has a profile in this org
    const existingProfile = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .unique();

    if (!existingProfile) {
      const firstInOrg = await ctx.db
        .query("profiles")
        .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
        .first();
      const role = firstInOrg === null ? "admin" : "employee";

      await ctx.db.insert("profiles", {
        userId,
        orgId,
        role,
        name: user.name ?? user.email ?? "User",
      });
    }

    await ctx.db.patch(userId, { selectedOrgId: orgId });
    return orgId;
  },
});
