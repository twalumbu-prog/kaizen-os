import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireRole } from "./lib/roles";

export const listForTemplate = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireRole(ctx, ["admin", "manager"]);
    const assignments = await ctx.db
      .query("reportAssignments")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .collect();
    return await Promise.all(
      assignments.map(async (a) => {
        const user = await ctx.db.get(a.userId);
        return { ...a, userName: user && "name" in user ? user.name : "Unknown" };
      }),
    );
  },
});

export const assign = mutation({
  args: { templateId: v.id("reportTemplates"), userId: v.id("users") },
  handler: async (ctx, { templateId, userId }) => {
    await requireRole(ctx, ["admin"]);
    const existing = await ctx.db
      .query("reportAssignments")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .filter((q) => q.eq(q.field("userId"), userId))
      .unique();
    if (existing) return existing._id;
    return await ctx.db.insert("reportAssignments", { templateId, userId });
  },
});

export const unassign = mutation({
  args: { assignmentId: v.id("reportAssignments") },
  handler: async (ctx, { assignmentId }) => {
    await requireRole(ctx, ["admin"]);
    await ctx.db.delete(assignmentId);
  },
});
