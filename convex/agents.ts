import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";
import { CHANNEL } from "./schema";
import { requireRole } from "./lib/roles";

const MODE = v.union(v.literal("off"), v.literal("draft"), v.literal("auto"));

export const DEFAULT_MODEL = "google/gemini-2.5-flash";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    return await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    title: v.string(),
    instructions: v.string(),
    model: v.optional(v.string()),
    mode: MODE,
    channels: v.array(CHANNEL),
    isSupervisor: v.boolean(),
    escalateToAgentId: v.optional(v.id("agents")),
    color: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await requireRole(ctx, ["admin"]);
    if (!args.name.trim()) throw new Error("Give the agent a name.");
    if (args.escalateToAgentId) await assertSameOrg(ctx, args.escalateToAgentId, profile.orgId);
    return await ctx.db.insert("agents", {
      orgId: profile.orgId,
      name: args.name.trim(),
      title: args.title.trim() || "Assistant",
      instructions: args.instructions,
      model: args.model?.trim() || DEFAULT_MODEL,
      mode: args.mode,
      channels: args.channels,
      isSupervisor: args.isSupervisor,
      escalateToAgentId: args.escalateToAgentId,
      color: args.color,
      createdBy: profile.userId,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    agentId: v.id("agents"),
    name: v.string(),
    title: v.string(),
    instructions: v.string(),
    model: v.string(),
    mode: MODE,
    channels: v.array(CHANNEL),
    isSupervisor: v.boolean(),
    escalateToAgentId: v.optional(v.id("agents")),
    color: v.string(),
  },
  handler: async (ctx, { agentId, ...patch }) => {
    const profile = await requireRole(ctx, ["admin"]);
    await assertSameOrg(ctx, agentId, profile.orgId);
    if (patch.escalateToAgentId) {
      if (patch.escalateToAgentId === agentId) throw new Error("An agent cannot escalate to itself.");
      await assertSameOrg(ctx, patch.escalateToAgentId, profile.orgId);
    }
    await ctx.db.patch(agentId, {
      ...patch,
      name: patch.name.trim(),
      title: patch.title.trim() || "Assistant",
      model: patch.model.trim() || DEFAULT_MODEL,
      escalateToAgentId: patch.escalateToAgentId,
    });
  },
});

export const remove = mutation({
  args: { agentId: v.id("agents") },
  handler: async (ctx, { agentId }) => {
    const profile = await requireRole(ctx, ["admin"]);
    await assertSameOrg(ctx, agentId, profile.orgId);
    // Conversations owned by this agent go back to unassigned; other agents that
    // escalated to it now escalate to a human.
    const owned = await ctx.db
      .query("inboxThreads")
      .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", profile.orgId))
      .filter((q) => q.eq(q.field("agentId"), agentId))
      .collect();
    for (const t of owned) await ctx.db.patch(t._id, { agentId: undefined });
    const others = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    for (const a of others) if (a.escalateToAgentId === agentId) await ctx.db.patch(a._id, { escalateToAgentId: undefined });
    await ctx.db.delete(agentId);
  },
});

async function assertSameOrg(
  ctx: { db: { get: (id: any) => Promise<any> } },
  agentId: any,
  orgId: string,
) {
  const a = await ctx.db.get(agentId);
  if (!a || a.orgId !== orgId) throw new Error("Agent not found.");
}

export const listForOrg = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) =>
    await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", orgId))
      .collect(),
});
