import { v } from "convex/values";
import { internalMutation } from "../_generated/server";

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for a redirect round-trip.

const PROVIDER = v.union(v.literal("quickbooks"), v.literal("google_drive"));

/** Issues a one-time OAuth `state` token bound to the org that requested it. */
export const createState = internalMutation({
  args: { orgId: v.id("organizations"), provider: PROVIDER },
  handler: async (ctx, { orgId, provider }) => {
    const token = crypto.randomUUID();
    await ctx.db.insert("oauthStates", { token, orgId, provider, expiresAt: Date.now() + STATE_TTL_MS });
    return token;
  },
});

/**
 * Resolves a `state` token back to the org that requested it, for the given
 * provider, and deletes it (single-use) — throws if the token is missing,
 * expired, or for the wrong provider, so a hand-crafted `state` can't be used
 * to bind a callback to an arbitrary org.
 */
export const consumeState = internalMutation({
  args: { token: v.string(), provider: PROVIDER },
  handler: async (ctx, { token, provider }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();
    if (!row) throw new Error("Invalid or already-used OAuth state");
    await ctx.db.delete(row._id);
    if (row.provider !== provider) throw new Error("OAuth state provider mismatch");
    if (row.expiresAt < Date.now()) throw new Error("OAuth state expired");
    return row.orgId;
  },
});
