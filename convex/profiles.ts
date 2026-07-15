import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ROLES } from "./schema";
import { requireRole } from "./lib/roles";

// Called from convex/auth.ts right after a user is created or signs in.
export const ensureProfile = internalMutation({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, { userId, name }) => {
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (existing !== null) return;

    // First user to ever sign up becomes an admin; everyone else starts as
    // an employee and is promoted by an admin later.
    const anyProfile = await ctx.db.query("profiles").first();
    const role = anyProfile === null ? "admin" : "employee";

    await ctx.db.insert("profiles", { userId, role, name });
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
