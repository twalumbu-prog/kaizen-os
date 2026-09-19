import { action, internalAction, internalMutation, internalQuery } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { extractAccountRows } from "./lib/qbExtract";

function findAccountBalanceInReport(rows: any[], accountId: string): number | null {
  for (const row of rows) {
    if (row.type === "Data") {
      const cols: any[] = row.ColData ?? [];
      if (cols[0]?.id === accountId) {
        const val = parseFloat(cols[1]?.value ?? "");
        return Number.isFinite(val) ? val : null;
      }
    }
    const nested = row.Rows?.Row;
    if (Array.isArray(nested)) {
      const found = findAccountBalanceInReport(nested, accountId);
      if (found !== null) return found;
    }
  }
  return null;
}
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

export const getAllSubmissionIds = internalQuery({
  args: {},
  handler: async (ctx) => {
    const submissions = await ctx.db.query("submissions").collect();
    return submissions.map((s) => s._id);
  },
});

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const ids = await ctx.runQuery(internal.revalidateAll.getAllSubmissionIds, {});
    for (const id of ids) {
      await ctx.runAction(internal.validationRunner.runValidation, { submissionId: id });
    }
  },
});

import { isExcludedDay } from "./lib/periods";

export const fixSharedTemplatesAndDups = internalMutation({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("reportTemplates").collect();
    let updatedTemplates = 0;
    for (const t of templates) {
      const isCanteen =
        t.validatorKey === "canteenSalesRecon" ||
        t.name.toLowerCase().includes("canteen");
      const isStatutory = t.name.toLowerCase().includes("statutory return");

      let patch: Record<string, any> = {};
      if ((isCanteen || isStatutory) && t.sharingMode !== "shared") {
        patch.sharingMode = "shared";
      }
      if (isCanteen && (!t.excludedDaysOfWeek || t.excludedDaysOfWeek.length === 0)) {
        patch.excludedDaysOfWeek = [0, 1, 6]; // Sunday, Monday, Saturday
      }

      if (Object.keys(patch).length > 0) {
        await ctx.db.patch(t._id, patch);
        updatedTemplates++;
      }
    }

    // Purge missing/pending submission rows that land on excluded days
    let purgedExcludedRows = 0;
    const allTemplates = await ctx.db.query("reportTemplates").collect();
    for (const t of allTemplates) {
      if (t.excludedDaysOfWeek?.length || t.excludedDates?.length) {
        const subs = await ctx.db
          .query("submissions")
          .withIndex("by_templateId", (q) => q.eq("templateId", t._id))
          .collect();
        for (const s of subs) {
          if ((s.status === "missing" || s.status === "pending") && isExcludedDay(new Date(s.periodStart), t)) {
            await ctx.db.delete(s._id);
            purgedExcludedRows++;
          }
        }
      }
    }

    let removedDups = 0;
    const sharedTemplates = (await ctx.db.query("reportTemplates").collect()).filter(
      (t) => t.sharingMode === "shared",
    );

    for (const t of sharedTemplates) {
      const submissions = await ctx.db
        .query("submissions")
        .withIndex("by_templateId", (q) => q.eq("templateId", t._id))
        .collect();

      const byPeriod = new Map<string, typeof submissions>();
      for (const s of submissions) {
        const group = byPeriod.get(s.periodLabel) ?? [];
        group.push(s);
        byPeriod.set(s.periodLabel, group);
      }

      for (const [, group] of byPeriod) {
        if (group.length <= 1) continue;

        const scoredGroup = await Promise.all(
          group.map(async (s) => {
            const files = await ctx.db
              .query("submissionFiles")
              .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
              .collect();
            const val = await ctx.db
              .query("validationResults")
              .withIndex("by_submissionId", (q) => q.eq("submissionId", s._id))
              .first();

            let score = 0;
            if (s.status === "submitted" || s.status === "late") score += 100;
            if (files.length > 0) score += 50;
            if (val) score += 25;

            return { s, files, val, score };
          }),
        );

        scoredGroup.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          return a.s._creationTime - b.s._creationTime;
        });

        const primary = scoredGroup[0];
        const duplicates = scoredGroup.slice(1);

        for (const dup of duplicates) {
          for (const f of dup.files) {
            const primaryFiles = await ctx.db
              .query("submissionFiles")
              .withIndex("by_submissionId", (q) => q.eq("submissionId", primary.s._id))
              .collect();
            if (!primaryFiles.some((pf) => pf.label === f.label)) {
              await ctx.db.patch(f._id, { submissionId: primary.s._id });
            }
          }

          await ctx.db.delete(dup.s._id);
          removedDups++;
        }
      }
    }

    return { updatedTemplates, purgedExcludedRows, removedDups };
  },
});

export const revalidateAllSubmissions = action({
  args: {},
  handler: async (ctx: ActionCtx): Promise<string> => {
    const cleanupRes = await ctx.runMutation(internal.revalidateAll.fixSharedTemplatesAndDups, {});
    console.log(`[RevalidateAll] Cleanup finished: updated ${cleanupRes.updatedTemplates} templates, purged ${cleanupRes.purgedExcludedRows} excluded-day rows, removed ${cleanupRes.removedDups} duplicate submissions.`);

    const ids = (await ctx.runQuery(internal.revalidateAll.getAllSubmissionIds, {})) as Id<"submissions">[];
    console.log(`[RevalidateAll] Revalidating and extracting data for ${ids.length} submissions...`);
    let count = 0;
    for (const id of ids) {
      try {
        await ctx.runAction(internal.validationRunner.runValidation, { submissionId: id });
        count++;
      } catch (err) {
        console.error(`[RevalidateAll] Error processing submission ${id}:`, err);
      }
    }
    return `Cleaned ${cleanupRes.removedDups} dups, purged ${cleanupRes.purgedExcludedRows} excluded rows & updated ${cleanupRes.updatedTemplates} templates. Successfully revalidated and extracted data for ${count} of ${ids.length} submissions.`;
  },
});

// ─── QB Ledger Backfill ───────────────────────────────────────────────────────

async function refreshQbTokenIfNeeded(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  config: { accessToken: string; refreshToken: string; expiresAt: number },
): Promise<string> {
  const BUFFER_MS = 5 * 60 * 1000;
  if (config.expiresAt && Date.now() < config.expiresAt - BUFFER_MS) return config.accessToken;

  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("QuickBooks credentials not configured");

  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refreshToken }),
  });
  if (!res.ok) throw new Error(`QB token refresh failed: ${await res.text()}`);
  const tokens = await res.json();
  const newConfig = {
    ...config,
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? config.refreshToken,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
    orgId,
    provider: "quickbooks",
    status: "active",
    config: JSON.stringify(newConfig),
  });
  return newConfig.accessToken;
}

export const getQbSubmissions = internalQuery({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Template not found");
    if (!template.quickbooksAccountId) throw new Error("Template is not mapped to a QuickBooks account");
    const dept = await ctx.db.get(template.departmentId);
    if (!dept) throw new Error("Department not found");

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .collect();

    return {
      quickbooksAccountId: template.quickbooksAccountId as string,
      orgId: dept.orgId,
      submissions: submissions
        .filter((s) => s.status !== "missing" && s.status !== "pending")
        .sort((a, b) => a.periodStart - b.periodStart)
        .map((s) => ({
          _id: s._id,
          periodStart: s.periodStart,
          periodEnd: s.periodEnd,
          periodLabel: s.periodLabel,
        })),
    };
  },
});

export const upsertInternalLedger = internalMutation({
  args: {
    submissionId: v.id("submissions"),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, { submissionId, storageId }) => {
    const files = await ctx.db
      .query("submissionFiles")
      .withIndex("by_submissionId", (q) => q.eq("submissionId", submissionId))
      .collect();
    const ledger = files.find((f) => f.label.toLowerCase() === "internal ledger");
    if (ledger) {
      await ctx.db.patch(ledger._id, {
        storageId,
        fileName: "quickbooks_ledger.csv",
        fileType: "csv",
      });
    } else {
      await ctx.db.insert("submissionFiles", {
        submissionId,
        storageId,
        label: "Internal Ledger",
        fileType: "csv",
        fileName: "quickbooks_ledger.csv",
      });
    }
  },
});

/**
 * Re-fetches the QuickBooks ledger for every already-submitted period under a
 * QB-mapped report template, replaces the stored "Internal Ledger" file with
 * the fresh QB data, and re-runs validation.
 *
 * Run via:
 *   npx convex run revalidateAll:backfillQbLedgers '{"templateId":"<id>"}'
 */
export const backfillQbLedgers = internalAction({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    const { quickbooksAccountId, orgId, submissions } = await ctx.runQuery(
      internal.revalidateAll.getQbSubmissions,
      { templateId },
    );

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId,
      provider: "quickbooks",
    });
    if (!integration || integration.status !== "active" || !integration.config) {
      throw new Error("QuickBooks integration is not active for this org");
    }

    const config = JSON.parse(integration.config);
    if (!config.realmId) throw new Error("Missing realmId in QB config — please reconnect QuickBooks");

    const accessToken = await refreshQbTokenIfNeeded(ctx, orgId, config);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

    // Resolve FullyQualifiedName for the mapped account (needed for row filtering)
    const acctQuery = `select Name, FullyQualifiedName from Account where Id = '${quickbooksAccountId}'`;
    const acctRes = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/query?query=${encodeURIComponent(acctQuery)}&minorversion=70`,
      { headers },
    );
    if (!acctRes.ok) {
      throw new Error(`QB account lookup failed: ${await acctRes.text()}`);
    }
    const acctData = await acctRes.json();
    const account = acctData.QueryResponse?.Account?.[0];
    if (!account) throw new Error("The mapped QB account was not found — has it been deleted?");
    const accountName: string = account.FullyQualifiedName ?? account.Name;

    console.log(
      `Backfilling ${submissions.length} period(s) with QB ledger for "${accountName}" …`,
    );

    const toDateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    for (const sub of submissions) {
      console.log(`  ${sub.periodLabel}: ${toDateStr(sub.periodStart)} – ${toDateStr(sub.periodEnd)}`);

      const reportRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/reports/TransactionList` +
          `?start_date=${toDateStr(sub.periodStart)}&end_date=${toDateStr(sub.periodEnd)}` +
          `&account=${quickbooksAccountId}&minorversion=70`,
        { headers },
      );
      if (!reportRes.ok) {
        console.error(`  QB report error for ${sub.periodLabel}:`, await reportRes.text());
        continue;
      }

      // Fetch the account's balance as of the day before the period starts.
      // NOTE: a bare `as_of` param is silently ignored by QuickBooks and always
      // returns today's balance — `start_date`/`end_date` with end_date as the
      // as-of date is what actually returns a historical point-in-time balance.
      const dayBefore = toDateStr(sub.periodStart - 86_400_000);
      const bsRes = await fetch(
        `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/reports/BalanceSheet` +
          `?start_date=2000-01-01&end_date=${dayBefore}&minorversion=70`,
        { headers },
      );
      let openingBalance = 0;
      if (bsRes.ok) {
        const bsData = await bsRes.json();
        const found = findAccountBalanceInReport(bsData.Rows?.Row ?? [], quickbooksAccountId);
        if (found !== null) openingBalance = found;
      } else {
        console.warn(`  QB BalanceSheet failed for ${sub.periodLabel} — defaulting to 0`);
      }

      const reportData = await reportRes.json();
      const rows: any[] = reportData.Rows?.Row ?? [];

      let csvContent = "Date,Description,Debit,Credit,Balance\n";
      csvContent += `,Opening Balance,,,${openingBalance.toFixed(2)}\n`;

      // Extract rows for this account, including synthesised rows for non-bank
      // Transfers where QB omits the bank-account side (see lib/qbExtract.ts).
      const accountRows = extractAccountRows(rows, accountName);
      let runningBalance = openingBalance;
      for (const { date, description, amount } of accountRows) {
        runningBalance += amount;
        const escaped = String(description).replace(/"/g, '""');
        csvContent +=
          amount > 0
            ? `${date},"${escaped}",${amount.toFixed(2)},,${runningBalance.toFixed(2)}\n`
            : `${date},"${escaped}",,${Math.abs(amount).toFixed(2)},${runningBalance.toFixed(2)}\n`;
      }

      const storageId = await ctx.storage.store(new Blob([csvContent], { type: "text/csv" }));
      await ctx.runMutation(internal.revalidateAll.upsertInternalLedger, {
        submissionId: sub._id,
        storageId,
      });
      await ctx.runAction(internal.validationRunner.runValidation, { submissionId: sub._id });
      console.log(`  Done ✓`);
    }

    console.log("QB ledger backfill complete.");
  },
});

/** CLI helper — lists all QB-linked templates with their account IDs.
 *  npx convex run revalidateAll:listQbTemplates
 */
export const listQbTemplates = internalQuery({
  args: {},
  handler: async (ctx) => {
    const templates = await ctx.db.query("reportTemplates").collect();
    return templates
      .filter((t) => t.quickbooksAccountId)
      .map((t) => ({ _id: t._id, name: t.name, quickbooksAccountId: t.quickbooksAccountId }));
  },
});
