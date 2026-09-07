import { internalMutation } from "../_generated/server";
import { v } from "convex/values";

export const remove = internalMutation({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await ctx.db.delete(templateId);
  },
});

export const create = internalMutation({
  args: {
    departmentId: v.id("departments"),
  },
  handler: async (ctx, { departmentId }) => {
    const existing = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .filter((q) => q.eq(q.field("validatorKey"), "adPerformance"))
      .first();
    if (existing) {
      console.log("Template already exists:", existing._id);
      return existing._id;
    }
    const id = await ctx.db.insert("reportTemplates", {
      departmentId,
      name: "Daily Ad Performance Tracking Sheet",
      cadence: "daily",
      validatorKey: "adPerformance",
      weight: 100,
      requiredFiles: [{ label: "Ad Performance Report", fileType: "xlsx", required: true }],
      validationRules: [],
    });
    console.log("Created template:", id);
    return id;
  },
});
