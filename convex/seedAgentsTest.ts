import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Dev-only fixture for trying the Agents inbox without touching real customers.
 * Creates (or reuses) the "Blue Opus Software" org, a WhatsApp account, and two agents.
 * Run with: npx convex run seedAgentsTest:seed
 */
export const seed = internalMutation({
  args: { phoneNumberId: v.optional(v.string()), mode: v.optional(v.union(v.literal("draft"), v.literal("auto"))) },
  handler: async (ctx, args) => {
    let org = await ctx.db.query("organizations").filter((q) => q.eq(q.field("name"), "Blue Opus Software")).first();
    const orgId = org?._id ?? (await ctx.db.insert("organizations", { name: "Blue Opus Software" } as never));
    org = await ctx.db.get(orgId);

    const profile = await ctx.db.query("profiles").first();
    const userId =
      profile?.userId ?? (await ctx.db.query("users").first())?._id ?? (await ctx.db.insert("users", { name: "Test Admin" }));

    const existing = await ctx.db.query("agents").withIndex("by_orgId", (q) => q.eq("orgId", orgId)).collect();
    if (existing.length === 0) {
      const sup = await ctx.db.insert("agents", {
        orgId, name: "Sam", title: "Supervisor", model: "google/gemini-2.5-flash", mode: "draft",
        instructions: "Review escalated conversations. Reply yourself if it is simple, otherwise leave it for a person.",
        channels: ["whatsapp", "gmail"], isSupervisor: true, color: "amber", createdBy: userId, createdAt: Date.now(),
      });
      await ctx.db.insert("agents", {
        orgId, name: "Amara", title: "Customer Service", model: "google/gemini-2.5-flash", mode: args.mode ?? "draft",
        instructions: "You work for Blue Opus Software, a software company. Answer questions about our services politely and briefly. Never quote prices. Refunds, complaints and anything legal go to the supervisor.",
        channels: ["whatsapp", "gmail"], isSupervisor: false, escalateToAgentId: sup, color: "violet", createdBy: userId, createdAt: Date.now(),
      });
    }

    const externalId = args.phoneNumberId ?? "TEST_PHONE_NUMBER_ID";
    const acct = await ctx.db.query("channelAccounts").withIndex("by_channel_externalId", (q) => q.eq("channel", "whatsapp").eq("externalId", externalId)).first();
    const accountId = acct?._id ?? (await ctx.db.insert("channelAccounts", {
      orgId, channel: "whatsapp", label: "Blue Opus WhatsApp", externalId, status: "active",
      // Deliberately not a real token: sends from this fixture must fail rather than reach a real person.
      config: JSON.stringify({ accessToken: "TEST_TOKEN_DO_NOT_SEND" }), createdAt: Date.now(),
    }));
    return { orgId, accountId };
  },
});
