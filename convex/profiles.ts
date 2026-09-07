import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ROLES } from "./schema";
import { requireRole } from "./lib/roles";

// Called from convex/auth.ts right after a user is created or signs in.
export const ensureProfile = internalMutation({
  args: { userId: v.id("users"), name: v.string(), orgName: v.optional(v.string()) },
  handler: async (ctx, { userId, name, orgName }) => {
    let orgId;
    if (orgName) {
      // Try to see if they provided a valid organization ID (acting as an invite code)
      const existingOrg = await ctx.db.normalizeId("organizations", orgName);
      if (existingOrg) {
        const org = await ctx.db.get(existingOrg);
        if (org) {
          orgId = org._id;
        }
      }

      // If not a valid existing ID, create a new organization
      if (!orgId) {
        orgId = await ctx.db.insert("organizations", { name: orgName });
      }
    } else {
      // Fallback: assign to first org or create a default one
      const anyOrg = await ctx.db.query("organizations").first();
      orgId = anyOrg ? anyOrg._id : await ctx.db.insert("organizations", { name: "Default Organization" });
    }

    // Skip if this user already has a profile in this org.
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId!))
      .filter((q) => q.eq(q.field("userId"), userId))
      .unique();
    if (existing !== null) return;

    // First user in the org becomes admin, subsequent users get employee role.
    const firstInOrg = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId!))
      .first();
    const role = firstInOrg === null ? "admin" : "employee";

    await ctx.db.insert("profiles", { userId, role, name, orgId: orgId! });

    // Set as the active org if the user has none selected yet.
    const user = await ctx.db.get(userId);
    if (user && !user.selectedOrgId) {
      await ctx.db.patch(userId, { selectedOrgId: orgId! });
    }
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const user = await ctx.db.get(userId);
    if (user === null) return null;

    const profiles = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    if (profiles.length === 0) return null;

    // Return the profile for the selected org, or the first one.
    const profile =
      (user.selectedOrgId && profiles.find((p) => p.orgId === user.selectedOrgId)) ||
      profiles[0];
    return { ...profile, email: user.email };
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    try {
      const profile = await requireRole(ctx, ["admin"]);
      const profiles = await ctx.db
        .query("profiles")
        .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
        .collect();
      return Promise.all(
        profiles.map(async (p) => {
          const user = await ctx.db.get(p.userId);
          return { ...p, email: user?.email };
        }),
      );
    } catch {
      return [];
    }
  },
});

export const setRoleAndDepartment = mutation({
  args: {
    profileId: v.id("profiles"),
    role: ROLES,
    departmentId: v.optional(v.id("departments")),
  },
  handler: async (ctx, { profileId, role, departmentId }) => {
    await requireRole(ctx, ["admin"]);
    await ctx.db.patch(profileId, { role, departmentId });
  },
});
