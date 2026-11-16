import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { CHANNEL } from "./schema";
import { requireRole } from "./lib/roles";

/** Create or refresh a connected account. Used by the Gmail connect action. */
export const upsert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    channel: CHANNEL,
    label: v.string(),
    externalId: v.string(),
    config: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("channelAccounts")
      .withIndex("by_channel_externalId", (q) => q.eq("channel", args.channel).eq("externalId", args.externalId))
      .first();
    if (existing) {
      // An account id can only ever belong to one organisation.
      if (existing.orgId !== args.orgId) throw new Error("That account is already connected to another organisation.");
      await ctx.db.patch(existing._id, { label: args.label, config: args.config ?? existing.config, status: "active", lastError: undefined });
      return existing._id;
    }
    return await ctx.db.insert("channelAccounts", {
      orgId: args.orgId,
      channel: args.channel,
      label: args.label,
      externalId: args.externalId,
      status: "active",
      config: args.config,
      createdAt: Date.now(),
    });
  },
});

/** WhatsApp / Instagram / Facebook: an admin pastes the Meta access token for the account. */
export const addMetaAccount = mutation({
  args: {
    channel: v.union(v.literal("whatsapp"), v.literal("instagram"), v.literal("facebook")),
    label: v.string(),
    /** WhatsApp phone_number_id, Instagram business account id, or Facebook Page id. */
    externalId: v.string(),
    /** Optional: when left out, the organisation's Meta integration token is used. */
    accessToken: v.optional(v.string()),
    /** Instagram only: the Facebook Page the account is linked to (messages are sent through the Page). */
    pageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const profile = await requireRole(ctx, ["admin"]);
    const externalId = args.externalId.trim();
    if (!externalId) throw new Error("The account id is required.");
    const existing = await ctx.db
      .query("channelAccounts")
      .withIndex("by_channel_externalId", (q) => q.eq("channel", args.channel).eq("externalId", externalId))
      .first();
    const config = JSON.stringify({ accessToken: args.accessToken?.trim() || undefined, pageId: args.pageId?.trim() || undefined });
    if (existing) {
      if (existing.orgId !== profile.orgId) throw new Error("That account is already connected to another organisation.");
      await ctx.db.patch(existing._id, { label: args.label.trim() || existing.label, config, status: "active", lastError: undefined });
      return existing._id;
    }
    return await ctx.db.insert("channelAccounts", {
      orgId: profile.orgId,
      channel: args.channel,
      label: args.label.trim() || externalId,
      externalId,
      status: "active",
      config,
      createdAt: Date.now(),
    });
  },
});

export const disconnect = mutation({
  args: { accountId: v.id("channelAccounts") },
  handler: async (ctx, { accountId }) => {
    const profile = await requireRole(ctx, ["admin"]);
    const a = await ctx.db.get(accountId);
    if (!a || a.orgId !== profile.orgId) throw new Error("Account not found.");
    await ctx.db.patch(accountId, { status: "disconnected", config: undefined });
  },
});

/** Facebook / Instagram accounts connected through Composio, which are polled like Gmail. */
export const listActiveComposioSocial = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("channelAccounts").collect();
    return all.filter((a) => {
      if (a.status !== "active" || (a.channel !== "facebook" && a.channel !== "instagram")) return false;
      try {
        return JSON.parse(a.config ?? "{}").provider === "composio";
      } catch {
        return false;
      }
    });
  },
});

export const listActiveGmail = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("channelAccounts").collect();
    return all.filter((a) => a.channel === "gmail" && a.status === "active");
  },
});

export const getByExternalId = internalQuery({
  args: { channel: CHANNEL, externalId: v.string() },
  handler: async (ctx, { channel, externalId }) =>
    await ctx.db
      .query("channelAccounts")
      .withIndex("by_channel_externalId", (q) => q.eq("channel", channel).eq("externalId", externalId))
      .first(),
});

export const get = internalQuery({
  args: { accountId: v.id("channelAccounts") },
  handler: async (ctx, { accountId }) => await ctx.db.get(accountId),
});

export const markSynced = internalMutation({
  args: { accountId: v.id("channelAccounts"), error: v.optional(v.string()) },
  handler: async (ctx, { accountId, error }) => {
    await ctx.db.patch(accountId, {
      lastError: error,
      ...(error ? {} : { lastSyncAt: Date.now() }),
    });
  },
});
