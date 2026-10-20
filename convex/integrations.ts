import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = (await ctx.db.query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect()).find((p) => p.orgId === args.orgId);

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
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("openrouter"), v.literal("meta"), v.literal("masterfees"), v.literal("moneywise"))
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const profile = (await ctx.db.query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect()).find((p) => p.orgId === args.orgId);

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

export const listQbIntegrations = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("integrations")
      .withIndex("by_orgId_provider")
      .filter(q => q.eq(q.field("provider"), "quickbooks"))
      .collect();
    return rows.map(r => {
      let cfg: Record<string, unknown> = {};
      try { cfg = JSON.parse(r.config ?? "{}"); } catch {}
      return {
        _id: r._id,
        orgId: r.orgId,
        status: r.status,
        hasAccessToken: !!cfg.accessToken,
        hasRefreshToken: !!cfg.refreshToken,
        realmId: cfg.realmId || "(empty)",
        composioConnectionId: cfg.composioConnectionId || null,
        expiresAt: cfg.expiresAt ? new Date(cfg.expiresAt as number).toISOString() : null,
      };
    });
  },
});

export const getInternalIntegration = internalQuery({
  args: {
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("openrouter"), v.literal("meta"), v.literal("masterfees"), v.literal("moneywise"))
  },
  handler: async (ctx, args) => {
    return await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", args.orgId).eq("provider", args.provider))
      .first();
  }
});

export const getActiveAiIntegration = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("integrations").collect();
    const active = all.find(i => i.status === "active" && (i.provider === "openrouter" || i.provider === "google_ai"));
    if (!active || !active.config) return null;
    try {
      const parsed = JSON.parse(active.config) as { apiKey?: string; model?: string };
      if (parsed.apiKey) {
        return {
          provider: active.provider as "openrouter" | "google_ai",
          apiKey: parsed.apiKey,
          model: parsed.model,
        };
      }
    } catch {}
    return null;
  },
});


export const updateIntegrationStatus = mutation({
  args: {
    orgId: v.id("organizations"),
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("openrouter"), v.literal("meta"), v.literal("masterfees"), v.literal("moneywise")),
    status: v.union(v.literal("active"), v.literal("disconnected")),
    config: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Unauthorized");

    const profile = (await ctx.db.query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect()).find((p) => p.orgId === args.orgId);

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
    provider: v.union(v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"), v.literal("google_ai"), v.literal("openrouter"), v.literal("meta"), v.literal("masterfees"), v.literal("moneywise")),
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

const FULL_PROVIDER = v.union(
  v.literal("quickbooks"), v.literal("resend"), v.literal("google_drive"),
  v.literal("google_ai"), v.literal("openrouter"), v.literal("meta"),
  v.literal("masterfees"), v.literal("moneywise")
);

/**
 * Atomically acquires a per-integration refresh lock.
 * Returns `{ acquired: true }` when the lock was taken, or
 * `{ acquired: false, accessToken }` when another refresh is in flight.
 */
export const acquireRefreshLock = internalMutation({
  args: { orgId: v.id("organizations"), provider: FULL_PROVIDER },
  handler: async (ctx, { orgId, provider }) => {
    const row = await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", orgId).eq("provider", provider))
      .first();
    if (!row?.config) return { acquired: false as const, accessToken: undefined };

    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(row.config); } catch {}

    const now = Date.now();
    const refreshingAt = typeof cfg.refreshingAt === "number" ? cfg.refreshingAt : 0;
    if (refreshingAt && now - refreshingAt < 60_000) {
      return { acquired: false as const, accessToken: typeof cfg.accessToken === "string" ? cfg.accessToken : undefined };
    }

    cfg.refreshingAt = now;
    await ctx.db.patch(row._id, { config: JSON.stringify(cfg) });
    return { acquired: true as const, accessToken: undefined };
  },
});

/** Saves rotated tokens and clears the refresh lock. */
export const saveRefreshedTokens = internalMutation({
  args: {
    orgId: v.id("organizations"),
    provider: FULL_PROVIDER,
    accessToken: v.string(),
    refreshToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, { orgId, provider, accessToken, refreshToken, expiresAt }) => {
    const row = await ctx.db.query("integrations")
      .withIndex("by_orgId_provider", q => q.eq("orgId", orgId).eq("provider", provider))
      .first();
    if (!row) return;

    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(row.config ?? "{}"); } catch {}

    cfg.accessToken = accessToken;
    cfg.refreshToken = refreshToken;
    cfg.expiresAt = expiresAt;
    delete cfg.refreshingAt;

    await ctx.db.patch(row._id, { config: JSON.stringify(cfg), status: "active" });
  },
});

export const seedOpenRouterForAllOrgs = internalMutation({
  args: {},
  handler: async (ctx) => {
    const orgs = await ctx.db.query("organizations").collect();
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return { count: 0, status: "No OPENROUTER_API_KEY set in environment" };
    const configStr = JSON.stringify({ apiKey, model: "~z-ai/glm-flash-latest" });

    for (const org of orgs) {
      const existing = await ctx.db.query("integrations")
        .withIndex("by_orgId_provider", q => q.eq("orgId", org._id).eq("provider", "openrouter"))
        .first();

      if (existing) {
        await ctx.db.patch(existing._id, { status: "active", config: configStr });
      } else {
        await ctx.db.insert("integrations", {
          orgId: org._id,
          provider: "openrouter",
          status: "active",
          config: configStr,
        });
      }
    }
    return { count: orgs.length };
  },
});
