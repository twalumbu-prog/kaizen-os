import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireProfile, requireRole } from "./lib/roles";

export const listForOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireProfile(ctx);
    return await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect();
  },
});

export const get = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    await requireProfile(ctx);
    return await ctx.db.get(departmentId);
  },
});

export const create = mutation({
  args: { orgId: v.id("organizations"), name: v.string(), slug: v.string() },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    return await ctx.db.insert("departments", args);
  },
});
