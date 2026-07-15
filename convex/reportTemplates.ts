import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { CADENCE, FILE_TYPE } from "./schema";
import { requireProfile, requireRole } from "./lib/roles";

export const listByDepartment = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    await requireProfile(ctx);
    return await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .collect();
  },
});

export const get = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireProfile(ctx);
    return await ctx.db.get(templateId);
  },
});

const REQUIRED_FILES = v.array(
  v.object({ label: v.string(), fileType: FILE_TYPE, required: v.boolean() }),
);
const VALIDATION_RULES = v.array(
  v.object({
    key: v.string(),
    label: v.string(),
    enabled: v.boolean(),
    tolerance: v.optional(v.number()),
  }),
);

export const create = mutation({
  args: {
    departmentId: v.id("departments"),
    name: v.string(),
    cadence: CADENCE,
    validatorKey: v.string(),
    weight: v.number(),
    requiredFiles: REQUIRED_FILES,
    validationRules: VALIDATION_RULES,
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    return await ctx.db.insert("reportTemplates", args);
  },
});

export const update = mutation({
  args: {
    templateId: v.id("reportTemplates"),
    name: v.optional(v.string()),
    cadence: v.optional(CADENCE),
    weight: v.optional(v.number()),
    requiredFiles: v.optional(REQUIRED_FILES),
    validationRules: v.optional(VALIDATION_RULES),
  },
  handler: async (ctx, { templateId, ...patch }) => {
    await requireRole(ctx, ["admin"]);
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    await ctx.db.patch(templateId, fields);
  },
});
