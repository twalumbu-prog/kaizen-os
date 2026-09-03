import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db.query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    return await ctx.db.query("integrations")
      .withIndex("by_orgId", q => q.eq("orgId", args.orgId))
      .collect();
  }
});

export const getIntegration = query({
  args: {
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("meta"))
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = await ctx.db.query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // Admins need full access to `config` for OAuth tokens / API keys.
    // Regular employees can read the integration status, but we must strip the config.
    if (!profile || profile.orgId !== args.orgId) {
      throw new Error("Unauthorized");
    }

    const integration = await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", args.orgId).eq("provider", args.provider))
      .first();
      
    if (integration && profile.role !== "admin") {
      integration.config = undefined;
    }

    return integration;
  }
});

export const getInternalIntegration = internalQuery({
  args: {
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("meta"))
  },
  handler: async (ctx, args) => {
    return await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", args.orgId).eq("provider", args.provider))
      .first();
  }
});

export const updateIntegrationStatus = mutation({
  args: {
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("meta")),
    status: v.union(v.literal("active"), v.literal("disconnected")),
    config: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const profile = await ctx.db.query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const existing = await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", args.orgId).eq("provider", args.provider))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { 
        status: args.status, 
        ...(args.config !== undefined ? { config: args.config } : {})
      });
      return existing._id;
    } else {
      return await ctx.db.insert("integrations", {
        orgId: args.orgId,
        provider: args.provider,
        status: args.status,
        config: args.config
      });
    }
  }
});

export const updateIntegrationStatusInternal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("meta")),
    status: v.union(v.literal("active"), v.literal("disconnected")),
    config: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", args.orgId).eq("provider", args.provider))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { 
        status: args.status, 
        ...(args.config !== undefined ? { config: args.config } : {})
      });
      return existing._id;
    } else {
      return await ctx.db.insert("integrations", {
        orgId: args.orgId,
        provider: args.provider,
        status: args.status,
        config: args.config
      });
    }
  }
});
