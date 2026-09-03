"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

const GRAPH = "https://graph.facebook.com/v21.0";

type MetaConfig = {
  accessToken: string;
  adAccountId?: string; // optional — all ad accounts are discovered automatically
  appId?: string;
  appSecret?: string;
};

/** Pull the Meta config for this org from the integrations table. */
async function getConfig(ctx: { runQuery: Function }, orgId: string): Promise<MetaConfig> {
  const integration = await ctx.runQuery(api.integrations.getIntegration, {
    orgId: orgId as any,
    provider: "meta",
  });
  if (!integration?.config) throw new Error("Meta integration is not configured for this org.");
  return JSON.parse(integration.config) as MetaConfig;
}

// ── Test connection ──────────────────────────────────────────────────────────

export const testConnection = action({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const cfg = await getConfig(ctx, args.orgId);
    const res = await fetch(
      `${GRAPH}/me?fields=id,name&access_token=${cfg.accessToken}`
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { ok: true, id: data.id as string, name: data.name as string };
  },
});

// ── Ad insights ──────────────────────────────────────────────────────────────

export type AdCampaignInsight = {
  campaignId: string;
  campaignName: string;
  impressions: number;
  clicks: number;
  spend: number; // USD
  reach: number;
  ctr: number; // percentage
  dateStart: string;
  dateStop: string;
};

export const fetchAdInsights = action({
  args: {
    orgId: v.id("organizations"),
    datePreset: v.optional(v.string()), // e.g. "last_30d", "last_7d", "this_month"
  },
  handler: async (ctx, args): Promise<AdCampaignInsight[]> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const cfg = await getConfig(ctx, args.orgId);
    const datePreset = args.datePreset ?? "last_30d";
    const fields = "campaign_name,campaign_id,impressions,clicks,spend,reach,ctr,date_start,date_stop";

    const url = `${GRAPH}/${cfg.adAccountId}/insights?fields=${fields}&date_preset=${datePreset}&level=campaign&limit=25&access_token=${cfg.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    return (data.data ?? []).map((row: any) => ({
      campaignId: row.campaign_id ?? "",
      campaignName: row.campaign_name ?? "Unknown",
      impressions: Number(row.impressions ?? 0),
      clicks: Number(row.clicks ?? 0),
      spend: parseFloat(row.spend ?? "0"),
      reach: Number(row.reach ?? 0),
      ctr: parseFloat(row.ctr ?? "0"),
      dateStart: row.date_start ?? "",
      dateStop: row.date_stop ?? "",
    }));
  },
});

// ── Campaign list (all campaigns, with or without spend) ─────────────────────

export type Campaign = {
  id: string;
  name: string;
  adAccountId: string;
  adAccountName: string;
  status: string;       // ACTIVE | PAUSED | ARCHIVED | DELETED
  objective: string;
  dailyBudget?: number; // cents
  lifetimeBudget?: number;
  startTime?: string;
  stopTime?: string;
  // Insights for the requested window — may be zeroes if no delivery
  impressions: number;
  clicks: number;
  spend: number;
  reach: number;
  ctr: number;
};

export const fetchCampaigns = action({
  args: {
    orgId: v.id("organizations"),
    datePreset: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Campaign[]> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const cfg = await getConfig(ctx, args.orgId);
    const datePreset = args.datePreset ?? "last_30d";

    // ── Step 1: Discover ALL ad accounts this token can access ──────────────
    // Strategy A: accounts directly on the user node
    const [directRes, bizRes] = await Promise.all([
      fetch(`${GRAPH}/me/adaccounts?fields=id,name,account_status&limit=50&access_token=${cfg.accessToken}`),
      fetch(`${GRAPH}/me/businesses?fields=id,name,owned_ad_accounts{id,name},client_ad_accounts{id,name}&limit=50&access_token=${cfg.accessToken}`),
    ]);
    const [directData, bizData] = await Promise.all([directRes.json(), bizRes.json()]);

    const seen = new Set<string>();
    const discovered: Array<{ id: string; name: string }> = [];

    const add = (id: string, name: string) => {
      if (!seen.has(id)) { seen.add(id); discovered.push({ id, name }); }
    };

    // Strategy A: user-direct
    for (const a of directData.data ?? []) add(a.id, a.name ?? a.id);

    // Strategy B: owned + client accounts under each business portfolio
    for (const biz of bizData.data ?? []) {
      const bizName = biz.name ?? biz.id;
      for (const a of biz.owned_ad_accounts?.data ?? [])  add(a.id, `${bizName} › ${a.name ?? a.id}`);
      for (const a of biz.client_ad_accounts?.data ?? []) add(a.id, `${bizName} › ${a.name ?? a.id}`);
    }

    // ── Step 2: Fetch campaigns from every account in parallel ──────────────
    const insightFields = `insights.date_preset(${datePreset}){impressions,clicks,spend,reach,ctr}`;
    const fields = `id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,${insightFields}`;

    const perAccountResults = await Promise.allSettled(
      discovered.map(async (acct) => {
        const url = `${GRAPH}/${acct.id}/campaigns?fields=${fields}&limit=50&access_token=${cfg.accessToken}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) return [] as Campaign[];
        return (data.data ?? []).map((c: any): Campaign => {
          const ins = c.insights?.data?.[0] ?? {};
          return {
            id: c.id,
            name: c.name,
            adAccountId: acct.id,
            adAccountName: acct.name,
            status: c.status ?? "UNKNOWN",
            objective: c.objective ?? "",
            dailyBudget: c.daily_budget ? Number(c.daily_budget) : undefined,
            lifetimeBudget: c.lifetime_budget ? Number(c.lifetime_budget) : undefined,
            startTime: c.start_time,
            stopTime: c.stop_time,
            impressions: Number(ins.impressions ?? 0),
            clicks: Number(ins.clicks ?? 0),
            spend: parseFloat(ins.spend ?? "0"),
            reach: Number(ins.reach ?? 0),
            ctr: parseFloat(ins.ctr ?? "0"),
          };
        });
      })
    );

    // Flatten all successful results, sort active first then by spend desc
    return perAccountResults
      .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
      .sort((a, b) => {
        if (a.status === "ACTIVE" && b.status !== "ACTIVE") return -1;
        if (b.status === "ACTIVE" && a.status !== "ACTIVE") return 1;
        return b.spend - a.spend;
      });
  },
});

// ── Instagram posts ──────────────────────────────────────────────────────────

export type InstagramPost = {
  id: string;
  caption: string;
  mediaType: string;
  timestamp: string;
  likeCount: number;
  commentsCount: number;
  permalink: string;
  thumbnailUrl?: string;
};

export type InstagramAccount = {
  igUserId: string;
  username: string;
  name: string;
  followersCount: number;
  strategy?: string;
};

/**
 * Discovers the Instagram Business Account ID using multiple strategies:
 * 1. Via Facebook Pages the token manages (most common)
 * 2. Via the token owner's own user node (creator / personal IG link)
 * 3. Via Business portfolios the token has access to
 *
 * Returns the first IG Business/Creator account found, plus a `diagnostics`
 * field describing what each strategy found so failures are debuggable.
 */
export const fetchInstagramAccount = action({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args): Promise<(InstagramAccount & { strategy: string }) | null> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const cfg = await getConfig(ctx, args.orgId);

    // ── Strategy 1: Pages the token manages ──────────────────────────────
    try {
      const pagesRes = await fetch(
        `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,name,username,followers_count}&access_token=${cfg.accessToken}`
      );
      const pagesData = await pagesRes.json();
      if (!pagesData.error) {
        for (const page of pagesData.data ?? []) {
          const ig = page.instagram_business_account;
          if (ig) {
            return {
              igUserId: ig.id,
              username: ig.username ?? "",
              name: ig.name ?? page.name,
              followersCount: ig.followers_count ?? 0,
              strategy: `Facebook Page "${page.name}"`,
            };
          }
        }
      }
    } catch {}

    // ── Strategy 2: Token owner's own linked IG account ──────────────────
    try {
      const meRes = await fetch(
        `${GRAPH}/me?fields=id,name,instagram_business_account{id,name,username,followers_count}&access_token=${cfg.accessToken}`
      );
      const meData = await meRes.json();
      if (!meData.error && meData.instagram_business_account) {
        const ig = meData.instagram_business_account;
        return {
          igUserId: ig.id,
          username: ig.username ?? "",
          name: ig.name ?? meData.name,
          followersCount: ig.followers_count ?? 0,
          strategy: "User node direct link",
        };
      }
    } catch {}

    // ── Strategy 3: Business portfolios ──────────────────────────────────
    try {
      const bizRes = await fetch(
        `${GRAPH}/me/businesses?fields=id,name,instagram_business_accounts{id,name,username,followers_count}&access_token=${cfg.accessToken}`
      );
      const bizData = await bizRes.json();
      if (!bizData.error) {
        for (const biz of bizData.data ?? []) {
          const accounts = biz.instagram_business_accounts?.data ?? [];
          if (accounts.length > 0) {
            const ig = accounts[0];
            return {
              igUserId: ig.id,
              username: ig.username ?? "",
              name: ig.name ?? biz.name,
              followersCount: ig.followers_count ?? 0,
              strategy: `Business portfolio "${biz.name}"`,
            };
          }
        }
      }
    } catch {}

    return null;
  },
});

export const fetchInstagramPosts = action({
  args: {
    orgId: v.id("organizations"),
    igUserId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<InstagramPost[]> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const cfg = await getConfig(ctx, args.orgId);
    const limit = args.limit ?? 12;
    const fields = "id,caption,media_type,timestamp,like_count,comments_count,permalink,thumbnail_url,media_url";

    const url = `${GRAPH}/${args.igUserId}/media?fields=${fields}&limit=${limit}&access_token=${cfg.accessToken}`;
    const res = await fetch(url);
    const data = await res.json();

    if (data.error) throw new Error(data.error.message);

    return (data.data ?? []).map((post: any) => ({
      id: post.id,
      caption: post.caption ?? "",
      mediaType: post.media_type ?? "IMAGE",
      timestamp: post.timestamp ?? "",
      likeCount: post.like_count ?? 0,
      commentsCount: post.comments_count ?? 0,
      permalink: post.permalink ?? "",
      thumbnailUrl: post.thumbnail_url ?? post.media_url ?? undefined,
    }));
  },
});

// ── Diagnostics ──────────────────────────────────────────────────────────────
// Surfaces what the token can see so permission gaps are immediately obvious.

export const diagnose = action({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const cfg = await getConfig(ctx, args.orgId);
    const token = cfg.accessToken;

    async function probe(label: string, url: string) {
      try {
        const r = await fetch(url);
        const d = await r.json();
        if (d.error) return { label, ok: false, detail: d.error.message };
        return { label, ok: true, detail: JSON.stringify(d).slice(0, 200) };
      } catch (e: any) {
        return { label, ok: false, detail: e.message };
      }
    }

    const results = await Promise.all([
      probe("Token identity (/me)", `${GRAPH}/me?fields=id,name&access_token=${token}`),
      probe(
        "Facebook Pages (/me/accounts)",
        `${GRAPH}/me/accounts?fields=id,name,instagram_business_account{id,username}&access_token=${token}`
      ),
      probe(
        "Business portfolios (/me/businesses)",
        `${GRAPH}/me/businesses?fields=id,name&access_token=${token}`
      ),
      probe(
        "Ad accounts — user direct (/me/adaccounts)",
        `${GRAPH}/me/adaccounts?fields=id,name,account_status&limit=10&access_token=${token}`
      ),
      probe(
        "Ad accounts — via businesses (owned + client)",
        `${GRAPH}/me/businesses?fields=id,name,owned_ad_accounts{id,name},client_ad_accounts{id,name}&limit=10&access_token=${token}`
      ),
      probe(
        "Token debug info",
        `${GRAPH}/debug_token?input_token=${token}&access_token=${token}`
      ),
    ]);

    return results;
  },
});
