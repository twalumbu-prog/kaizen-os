import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ROLES } from "./schema";
import { requireRole } from "./lib/roles";
import type { Id } from "./_generated/dataModel";

// Called from convex/auth.ts right after a user is created or signs in.
export const ensureProfile = internalMutation({
  args: { userId: v.id("users"), name: v.string(), orgName: v.optional(v.string()) },
  handler: async (ctx, { userId, name, orgName }) => {
    const user = await ctx.db.get(userId);
    if (!user) return;

    const userProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    let orgId: Id<"organizations"> | undefined;

    if (orgName && orgName.trim().length > 0) {
      const trimmed = orgName.trim();
      // 1. Try to see if orgName is a valid organization ID (acting as an invite code)
      const existingOrg = await ctx.db.normalizeId("organizations", trimmed);
      if (existingOrg) {
        const org = await ctx.db.get(existingOrg);
        if (org) {
          orgId = org._id;
        }
      }

      // 2. Try to see if orgName matches an existing organization by exact name
      if (!orgId) {
        const orgByName = await ctx.db
          .query("organizations")
          .filter((q) => q.eq(q.field("name"), trimmed))
          .first();
        if (orgByName) {
          orgId = orgByName._id;
        }
      }

      // 3. If not found by ID or name, create a new organization
      if (!orgId) {
        orgId = await ctx.db.insert("organizations", { name: trimmed });
      }
    } else if (userProfiles.length === 0) {
      // Fallback: only assign to first org or create a default one if user has NO profiles at all
      const anyOrg = await ctx.db.query("organizations").first();
      orgId = anyOrg ? anyOrg._id : await ctx.db.insert("organizations", { name: "Default Organization" });
    }

    if (orgId) {
      const existingInOrg = userProfiles.find((p) => p.orgId === orgId);
      if (!existingInOrg) {
        const firstInOrg = await ctx.db
          .query("profiles")
          .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
          .first();
        const role = firstInOrg === null ? "admin" : "employee";

        await ctx.db.insert("profiles", { userId, role, name, orgId });
      }

      // Always switch active org to the target org when joining/creating an org
      await ctx.db.patch(userId, { selectedOrgId: orgId });
    } else if (!user.selectedOrgId && userProfiles.length > 0) {
      await ctx.db.patch(userId, { selectedOrgId: userProfiles[0].orgId });
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
