import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfile, requireRole } from "./lib/roles";

export const listForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const profile = await requireProfile(ctx);
    if (profile.orgId !== orgId) throw new Error("Unauthorized");
    return await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const get = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    const profile = await requireProfile(ctx);
    const dept = await ctx.db.get(departmentId);
    if (!dept) return null;
    if (dept.orgId !== profile.orgId) throw new Error("Unauthorized");
    return dept;
  },
});

export const create = mutation({
  args: { orgId: v.id("organizations"), name: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    const profile = await requireRole(ctx, ["admin"]);
    if (profile.orgId !== args.orgId) throw new Error("Unauthorized");
    return await ctx.db.insert("departments", args);
  },
});
