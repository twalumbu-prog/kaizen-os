import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { CADENCE, CYCLE_CONFIG, FILE_TYPE } from "./schema";
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

export const listFinanceTemplates = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    // Fetch all departments for this org
    const departments = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    
    // Fetch all templates for these departments
    const allTemplates = await Promise.all(
      departments.map(dept => 
        ctx.db.query("reportTemplates")
          .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
          .collect()
      )
    );
    
    // Flatten and filter for bankReconciliation
    return allTemplates.flat().filter(t => t.validatorKey === "bankReconciliation");
  },
});

const REQUIRED_FILES = v.array(
  v.object({ label: v.string(), fileTypes: v.array(FILE_TYPE), required: v.boolean() }),
);

function assertEveryRequiredFileHasAFormat(requiredFiles: { label: string; fileTypes: string[] }[]) {
  const empty = requiredFiles.find((f) => f.fileTypes.length === 0);
  if (empty) throw new Error(`"${empty.label}" needs at least one accepted file format.`);
}
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
    cycle: v.optional(CYCLE_CONFIG),
    dueDayOfMonth: v.optional(v.number()),
    validatorKey: v.string(),
    weight: v.number(),
    startingBalance: v.optional(v.number()),
    requiredFiles: REQUIRED_FILES,
    validationRules: VALIDATION_RULES,
    quickbooksAccountId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    assertEveryRequiredFileHasAFormat(args.requiredFiles);
    return await ctx.db.insert("reportTemplates", args);
  },
});

export const update = mutation({
  args: {
    templateId: v.id("reportTemplates"),
    name: v.optional(v.string()),
    cadence: v.optional(CADENCE),
    cycle: v.optional(CYCLE_CONFIG),
    dueDayOfMonth: v.optional(v.number()),
    weight: v.optional(v.number()),
    startingBalance: v.optional(v.number()),
    requiredFiles: v.optional(REQUIRED_FILES),
    validationRules: v.optional(VALIDATION_RULES),
    quickbooksAccountId: v.optional(v.string()),
  },
  handler: async (ctx, { templateId, ...patch }) => {
    await requireRole(ctx, ["admin"]);
    if (patch.requiredFiles) assertEveryRequiredFileHasAFormat(patch.requiredFiles);
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    await ctx.db.patch(templateId, fields);
  },
});
