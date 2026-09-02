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

export const update = mutation({
  args: {
    departmentId: v.id("departments"),
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, { departmentId, name, slug }) => {
    const profile = await requireRole(ctx, ["admin"]);
    const dept = await ctx.db.get(departmentId);
    if (!dept) throw new Error("Department not found");
    if (dept.orgId !== profile.orgId) throw new Error("Unauthorized");
    await ctx.db.patch(departmentId, { name, slug });
  },
});

export const remove = mutation({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    const profile = await requireRole(ctx, ["admin"]);
    const dept = await ctx.db.get(departmentId);
    if (!dept) throw new Error("Department not found");
    if (dept.orgId !== profile.orgId) throw new Error("Unauthorized");

    // Refuse to orphan report templates or the people assigned to the
    // department — the admin has to move those first.
    const templates = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .collect();
    if (templates.length > 0) {
      throw new Error(
        `Department still has ${templates.length} report template(s). Delete or move them first.`,
      );
    }

    const orgProfiles = await ctx.db
      .query("profiles")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    const members = orgProfiles.filter((p) => p.departmentId === departmentId);
    if (members.length > 0) {
      throw new Error(
        `Department still has ${members.length} member(s). Reassign them first.`,
      );
    }

    await ctx.db.delete(departmentId);
  },
});
