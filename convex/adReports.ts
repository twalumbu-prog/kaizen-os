"use node";

import * as XLSX from "xlsx";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { periodContaining } from "./lib/periods";
import type { Id } from "./_generated/dataModel";

const GRAPH = "https://graph.facebook.com/v21.0";

// ── Cron entry-point ─────────────────────────────────────────────────────────

export const autoSubmitAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const targets = await ctx.runQuery(internal.adReportsData.findTargets, {});
    for (const target of targets) {
      try {
        await submitForTarget(ctx, target);
      } catch (err) {
        console.error(`[adReports] Failed for org ${target.orgId}:`, err);
      }
    }
  },
});

// ── Manual trigger (for testing / backfill) ──────────────────────────────────

export const manualSubmit = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const targets = await ctx.runQuery(internal.adReportsData.findTargets, {});
    const target = targets.find((t) => t.orgId === orgId);
    if (!target) throw new Error("No adPerformance template + active Meta integration found for this org.");
    await submitForTarget(ctx, target);
  },
});

// ── Core logic ───────────────────────────────────────────────────────────────

async function submitForTarget(
  ctx: { storage: { store: (b: Blob) => Promise<Id<"_storage">> }; runMutation: Function },
  target: { orgId: Id<"organizations">; templateId: Id<"reportTemplates">; userId: Id<"users">; accessToken: string; adAccountIds: string[]; template: { cadence: string; [k: string]: unknown } },
) {
  const token = target.accessToken;

  // We target "yesterday" so the data is complete.
  const yesterday = new Date(Date.now() - 86_400_000);
  const dateStr   = yesterday.toISOString().slice(0, 10);

  const rows: AdRow[] = [];

  // ── Facebook Ads ──────────────────────────────────────────────────────────
  try {
    const fbRows = await fetchFacebookRows(token, dateStr, target.adAccountIds);
    rows.push(...fbRows);
  } catch (err) {
    console.warn("[adReports] Facebook fetch failed:", err);
  }

  // ── Instagram posts ───────────────────────────────────────────────────────
  try {
    const igRows = await fetchInstagramRows(token, dateStr);
    rows.push(...igRows);
  } catch (err) {
    console.warn("[adReports] Instagram fetch failed:", err);
  }

  if (rows.length === 0) {
    console.log(`[adReports] No ad data for ${dateStr} — skipping submission.`);
    return;
  }

  // Build Excel workbook.
  const buffer = buildExcel(rows, dateStr);
  const blob   = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const storageId = await ctx.storage.store(blob);

  // Resolve the period that contains yesterday.
  const period = periodContaining(target.template as any, yesterday.getTime());

  await ctx.runMutation(internal.submissions.autoSubmitInternal, {
    templateId:  target.templateId,
    userId:      target.userId,
    storageId,
    fileName:    `ad-performance-${dateStr}.xlsx`,
    fileLabel:   "Daily Ad Performance Report",
    periodLabel: period.periodLabel,
    periodStart: period.periodStart,
    periodEnd:   period.periodEnd,
    dueAt:       period.dueAt,
  });

  console.log(`[adReports] Submitted ${rows.length} rows for org ${target.orgId} (${dateStr}).`);
}

// ── Facebook Ads fetch ────────────────────────────────────────────────────────

interface AdRow {
  date: string;
  adName: string;
  format: string;
  platform: string;
  views: number;
  engagements: number;
  linkClicks: number;
  ctr: number;
  engagementRate: number;
  conversionRate: number;
}

async function fetchFacebookRows(token: string, dateStr: string, explicitAccountIds: string[] = []): Promise<AdRow[]> {
  // Auto-discover ad accounts the token can see.
  const acctRes  = await fetch(`${GRAPH}/me/adaccounts?fields=id,name&limit=50&access_token=${token}`);
  const acctData = await acctRes.json();
  const discovered: Array<{ id: string }> = acctData.data ?? [];

  // Merge with any explicitly configured account IDs — normalise, dedupe.
  const seen = new Set(discovered.map((a) => a.id));
  for (const id of explicitAccountIds) {
    const normalised = id.startsWith("act_") ? id : `act_${id}`;
    if (!seen.has(normalised)) { discovered.push({ id: normalised }); seen.add(normalised); }
  }
  const accounts = discovered;

  const rows: AdRow[] = [];

  for (const acct of accounts) {
    const dateRange = `{"since":"${dateStr}","until":"${dateStr}"}`;
    const fields    = [
      "name",
      "creative{object_type,body}",
      `insights.time_range(${encodeURIComponent(dateRange)}){impressions,clicks,reach,ctr,actions}`,
    ].join(",");

    const url  = `${GRAPH}/${acct.id}/ads?fields=${fields}&limit=100&access_token=${token}`;
    const res  = await fetch(url);
    const data = await res.json();

    for (const ad of data.data ?? []) {
      const ins = ad.insights?.data?.[0] ?? {};
      const impressions = Number(ins.impressions ?? 0);
      const clicks      = Number(ins.clicks ?? 0);
      const reach       = Number(ins.reach ?? 0);
      const ctr         = parseFloat(ins.ctr ?? "0");
      const actions: Array<{ action_type: string; value: string }> = ins.actions ?? [];

      const linkClicks  = actionValue(actions, "link_click");
      const engagements = actionValue(actions, "post_engagement");
      const conversions = actionValue(actions, "offsite_conversion.fb_pixel_purchase") +
                          actionValue(actions, "lead");

      const engagementRate = reach > 0 ? (engagements / reach) * 100 : 0;
      const conversionRate = clicks > 0 ? (conversions / clicks) * 100 : 0;

      const rawType: string = ad.creative?.object_type ?? "";
      const format = rawType.toLowerCase().includes("video") ? "Video" : "Image";

      rows.push({
        date:           dateStr,
        adName:         ad.name ?? "Unknown Ad",
        format,
        platform:       "Facebook",
        views:          impressions,
        engagements,
        linkClicks,
        ctr,
        engagementRate: round2(engagementRate),
        conversionRate: round2(conversionRate),
      });
    }
  }

  return rows;
}

function actionValue(actions: Array<{ action_type: string; value: string }>, type: string): number {
  return actions.filter((a) => a.action_type === type).reduce((s, a) => s + Number(a.value), 0);
}

// ── Instagram organic posts fetch ─────────────────────────────────────────────

async function fetchInstagramRows(token: string, dateStr: string): Promise<AdRow[]> {
  // Discover the IG business account via Facebook pages.
  const pagesRes  = await fetch(`${GRAPH}/me/accounts?fields=instagram_business_account{id,followers_count}&access_token=${token}`);
  const pagesData = await pagesRes.json();

  let igUserId: string | null = null;
  let followers = 0;
  for (const page of pagesData.data ?? []) {
    const ig = page.instagram_business_account;
    if (ig?.id) { igUserId = ig.id; followers = ig.followers_count ?? 0; break; }
  }
  if (!igUserId) return [];

  const fields = "id,caption,media_type,timestamp,like_count,comments_count";
  const mediaRes  = await fetch(`${GRAPH}/${igUserId}/media?fields=${fields}&limit=100&access_token=${token}`);
  const mediaData = await mediaRes.json();

  const rows: AdRow[] = [];
  for (const post of mediaData.data ?? []) {
    const postDate = (post.timestamp as string | undefined)?.slice(0, 10) ?? "";
    if (postDate !== dateStr) continue; // Only yesterday's posts.

    const likes    = Number(post.like_count    ?? 0);
    const comments = Number(post.comments_count ?? 0);
    const engagements = likes + comments;
    const engagementRate = followers > 0 ? (engagements / followers) * 100 : 0;

    const mediaType: string = (post.media_type ?? "IMAGE").toUpperCase();
    const format = mediaType === "VIDEO" ? "Video" : "Image";

    // Fetch video views for video posts.
    let views = 0;
    if (mediaType === "VIDEO") {
      try {
        const insRes  = await fetch(`${GRAPH}/${post.id}/insights?metric=video_views&access_token=${token}`);
        const insData = await insRes.json();
        views = Number(insData.data?.[0]?.values?.[0]?.value ?? 0);
      } catch { /* ignore */ }
    }

    rows.push({
      date:           dateStr,
      adName:         (post.caption as string | undefined)?.slice(0, 80) ?? post.id,
      format,
      platform:       "Instagram",
      views,
      engagements,
      linkClicks:     0, // not available for organic posts
      ctr:            0,
      engagementRate: round2(engagementRate),
      conversionRate: 0,
    });
  }

  return rows;
}

// ── Excel builder ─────────────────────────────────────────────────────────────

function buildExcel(rows: AdRow[], dateStr: string): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const header = [
    "Date",
    "Ad Name",
    "Format",
    "Platform",
    "Views",
    "Engagements",
    "Link Clicks",
    "CTR (%)",
    "Engagement Rate (%)",
    "Conversion Rate (%)",
  ];
  const data = [
    header,
    ...rows.map((r) => [
      r.date,
      r.adName,
      r.format,
      r.platform,
      r.views,
      r.engagements,
      r.linkClicks,
      r.ctr,
      r.engagementRate,
      r.conversionRate,
    ]),
  ];

  const ws = XLSX.utils.aoa_to_sheet(data);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, // Date
    { wch: 40 }, // Ad Name
    { wch: 10 }, // Format
    { wch: 12 }, // Platform
    { wch: 10 }, // Views
    { wch: 12 }, // Engagements
    { wch: 12 }, // Link Clicks
    { wch: 10 }, // CTR
    { wch: 20 }, // Engagement Rate
    { wch: 18 }, // Conversion Rate
  ];

  XLSX.utils.book_append_sheet(wb, ws, `Ad Performance ${dateStr}`);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return buf;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
