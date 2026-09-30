import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const KIND = "recruitmentLeads";

export type RecruitmentConfig = {
  /** Emails addressed to any of these are treated as candidate applications. */
  matchAddresses: string[];
  sheetTitle: string;
  sheetId?: string;
  sheetUrl?: string;
};

const DEFAULT_CONFIG: RecruitmentConfig = {
  matchAddresses: ["careers@twalumbueducentre.com"],
  sheetTitle: "Talent Leads Master List",
};

/** Creates the recruitment automation for the Twalumbu Mastery Program org. Idempotent. */
export const seed = internalMutation({
  args: { orgName: v.string() },
  handler: async (ctx, { orgName }) => {
    const org = (await ctx.db.query("organizations").collect()).find((o) => o.name === orgName);
    if (!org) throw new Error(`Organization "${orgName}" not found`);
    const existing = (
      await ctx.db.query("automations").withIndex("by_orgId", (q) => q.eq("orgId", org._id)).collect()
    ).find((a) => a.kind === KIND);
    if (existing) return { created: false, id: existing._id };
    const id = await ctx.db.insert("automations", {
      orgId: org._id,
      kind: KIND,
      name: "Recruitment Talent Leads",
      description:
        "Checks the careers inbox in Zoho Mail for new job applications, extracts each applicant's position, name, contact details and qualifications, and adds them to the Talent Leads Master List in Google Drive (Human Resources › 02_Recruitment & Hiring › Recruitment Leads & Contacts).",
      schedule: "Every 2 hours",
      enabled: true,
      config: JSON.stringify(DEFAULT_CONFIG),
    });
    return { created: true, id };
  },
});

export const load = internalQuery({
  args: { automationId: v.id("automations") },
  handler: async (ctx, { automationId }) => {
    const a = await ctx.db.get(automationId);
    if (!a) return null;
    let config: RecruitmentConfig = DEFAULT_CONFIG;
    try {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(a.config ?? "{}") };
    } catch {}
    return { orgId: a.orgId, config };
  },
});

export const unprocessed = internalQuery({
  args: { automationId: v.id("automations"), itemIds: v.array(v.string()) },
  handler: async (ctx, { automationId, itemIds }) => {
    const out: string[] = [];
    for (const itemId of itemIds) {
      const hit = await ctx.db
        .query("automationProcessed")
        .withIndex("by_automationId_itemId", (q) => q.eq("automationId", automationId).eq("itemId", itemId))
        .first();
      if (!hit) out.push(itemId);
    }
    return out;
  },
});

export const markProcessed = internalMutation({
  args: { automationId: v.id("automations"), items: v.array(v.object({ itemId: v.string(), note: v.string() })) },
  handler: async (ctx, { automationId, items }) => {
    for (const it of items) {
      const hit = await ctx.db
        .query("automationProcessed")
        .withIndex("by_automationId_itemId", (q) => q.eq("automationId", automationId).eq("itemId", it.itemId))
        .first();
      if (!hit) await ctx.db.insert("automationProcessed", { automationId, itemId: it.itemId, note: it.note });
    }
  },
});

export const saveSheet = internalMutation({
  args: { automationId: v.id("automations"), sheetId: v.string(), sheetUrl: v.string() },
  handler: async (ctx, { automationId, sheetId, sheetUrl }) => {
    const a = await ctx.db.get(automationId);
    if (!a) return;
    let cfg: Record<string, unknown> = {};
    try {
      cfg = JSON.parse(a.config ?? "{}");
    } catch {}
    await ctx.db.patch(automationId, { config: JSON.stringify({ ...cfg, sheetId, sheetUrl }) });
  },
});

export const listEnabled = internalQuery({
  args: {},
  handler: async (ctx) =>
    (await ctx.db.query("automations").collect()).filter((a) => a.enabled && a.kind === KIND).map((a) => a._id),
});
