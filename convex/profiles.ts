import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ROLES } from "./schema";
import { requireRole } from "./lib/roles";

// Called from convex/auth.ts right after a user is created or signs in.
export const ensureProfile = internalMutation({
  args: { userId: v.id("users"), name: v.string(), orgName: v.optional(v.string()) },
  handler: async (ctx, { userId, name, orgName }) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing !== null) return;

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
      // Fallback for existing users / logic
      const anyOrg = await ctx.db.query("organizations").first();
      if (anyOrg) {
        orgId = anyOrg._id;
      } else {
        orgId = await ctx.db.insert("organizations", { name: "Default Organization" });
      }
    }

    // First user in the org becomes admin
    const firstInOrg = await ctx.db.query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId!))
      .first();
    const role = firstInOrg === null ? "admin" : "employee";

    await ctx.db.insert("profiles", { userId, role, name, orgId: orgId! });
  },
});

export const getMe = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (profile === null) return null;
    const user = await ctx.db.get(userId);
    return { ...profile, email: user?.email };
  },
});

export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireRole(ctx, ["admin"]);
    const profiles = await ctx.db.query("profiles").collect();
    return Promise.all(
      profiles.map(async (p) => {
        const user = await ctx.db.get(p.userId);
        return { ...p, email: user?.email };
      }),
    );
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
