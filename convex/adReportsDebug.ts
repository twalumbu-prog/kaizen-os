"use node";

import { internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

const GRAPH = "https://graph.facebook.com/v21.0";

export const debugFetch = internalAction({
  args: { orgId: v.id("organizations"), dateStr: v.string() },
  handler: async (ctx, { orgId, dateStr }) => {
    const targets = await ctx.runQuery(internal.adReportsData.findTargets, {});
    const target = targets.find((t) => t.orgId === orgId);
    if (!target) throw new Error("No target found");

    const token = target.accessToken;

    // 1. Discover ad accounts.
    const acctRes = await fetch(`${GRAPH}/me/adaccounts?fields=id,name&limit=50&access_token=${token}`);
    const acctData = await acctRes.json() as { data?: { id: string; name: string }[]; error?: unknown };
    const accounts = acctData.data ?? [];
    console.log("Ad accounts discovered:", JSON.stringify(accounts.map(a => a.id)));

    // 2. For each account, count ads returned.
    for (const acct of accounts) {
      const dateRange = `{"since":"${dateStr}","until":"${dateStr}"}`;
      const allStatuses = encodeURIComponent(
        JSON.stringify(["ACTIVE","PAUSED","CAMPAIGN_PAUSED","ADSET_PAUSED","IN_PROCESS","WITH_ISSUES"])
      );
      const fields = [
        "name",
        `insights.time_range(${encodeURIComponent(dateRange)}){impressions}`,
      ].join(",");
      const url = `${GRAPH}/${acct.id}/ads?fields=${fields}&effective_status=${allStatuses}&limit=200&access_token=${token}`;
      const res = await fetch(url);
      const data = await res.json() as { data?: unknown[]; error?: unknown };
      console.log(`Account ${acct.id}: ${(data.data ?? []).length} ads returned`);
      if (data.error) console.log("API error:", JSON.stringify(data.error));

      // Show first 3 ad names.
      const ads = (data.data ?? []) as Array<{ name?: string; insights?: { data?: Array<{ impressions?: string }> } }>;
      for (const ad of ads.slice(0, 3)) {
        console.log(`  - "${ad.name}" | impressions: ${ad.insights?.data?.[0]?.impressions ?? "none"}`);
      }
    }
  },
});
