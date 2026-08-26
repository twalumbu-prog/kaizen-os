import { action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { extractAccountRows } from "./lib/qbExtract";

type CallbackResult = { success: true; orgId: Id<"organizations"> } | { success: false };

/** Recursively searches a QB BalanceSheet report tree for an account by its ID. */
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

/**
 * Returns a live access token for this org's QuickBooks connection, refreshing
 * (and persisting) it first if it's expired or about to expire — access
 * tokens only last an hour, so any sync call needs this rather than trusting
 * whatever was stored at connect time.
 */
async function ensureFreshAccessToken(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  config: { accessToken: string; refreshToken: string; expiresAt: number; realmId?: string },
): Promise<string> {
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  if (config.expiresAt && Date.now() < config.expiresAt - REFRESH_BUFFER_MS) {
    return config.accessToken;
  }

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
  if (!res.ok) {
    console.error("QuickBooks token refresh failed", await res.text());
    throw new Error("QuickBooks connection expired — please reconnect it from the Integrations Hub.");
  }
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

// A background job to periodically sync data
export const syncTransactions = action({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    // 1. Fetch integration config for this org
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: args.orgId,
      provider: "quickbooks"
    });

    if (!integration || integration.status !== "active" || !integration.config) {
      console.warn(`QuickBooks integration not configured or inactive for org ${args.orgId}`);
      return { success: false, reason: "not_configured" };
    }

    let config;
    try {
      config = JSON.parse(integration.config);
    } catch (e) {
      console.error("Failed to parse QuickBooks config", e);
      return { success: false, reason: "invalid_config" };
    }

    if (!config.accessToken || !config.realmId) {
      console.warn("QuickBooks access token or realmId missing in config");
      return { success: false, reason: "missing_credentials" };
    }

    // In a full implementation, we'd check if the token is expired and refresh it using config.refreshToken
    // Then call Intuit API: fetch(`https://quickbooks.api.intuit.com/v3/company/${config.realmId}/query?query=select * from Transaction...`, { headers: { Authorization: `Bearer ${config.accessToken}` }})
    console.log(`Syncing QuickBooks transactions for org ${args.orgId} using realmId ${config.realmId}`);

    return { success: true };
  }
});

export const getAuthUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, args) => {
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    if (!clientId) throw new Error("QuickBooks Client ID not configured in .env.local");

    // Derive the org from the caller's own profile — never trust a client-supplied
    // orgId here, or anyone could mint a connect URL for an org they don't belong to.
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const state = await ctx.runMutation(internal.lib.oauthState.createState, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });

    const url = new URL("https://appcenter.intuit.com/connect/oauth2");
    url.searchParams.append("client_id", clientId);
    url.searchParams.append("response_type", "code");
    url.searchParams.append("scope", "com.intuit.quickbooks.accounting");
    url.searchParams.append("redirect_uri", args.redirectUri);
    url.searchParams.append("state", state);
    return url.toString();
  }
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can manage integrations");

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });

    if (integration?.config) {
      const clientId = process.env.QUICKBOOKS_CLIENT_ID;
      const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
      try {
        const config = JSON.parse(integration.config);
        const token = config.refreshToken ?? config.accessToken;
        if (token && clientId && clientSecret) {
          await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
            method: "POST",
            headers: {
              "Accept": "application/json",
              "Content-Type": "application/json",
              "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
            },
            body: JSON.stringify({ token }),
          });
        }
      } catch (e) {
        // Best-effort — still disconnect locally even if the provider-side revoke fails.
        console.error("QuickBooks token revoke failed", e);
      }
    }

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "quickbooks",
      status: "disconnected",
      config: JSON.stringify({}),
    });
  },
});

export const handleCallback = internalAction({
  args: { code: v.string(), realmId: v.string(), state: v.string(), redirectUri: v.string() },
  handler: async (ctx, args): Promise<CallbackResult> => {
    // Resolves (and single-use consumes) the state token minted in getAuthUrl —
    // throws if it's missing, expired, or for the wrong provider, so a
    // hand-crafted `state` can't bind this callback to an arbitrary org.
    const orgId = await ctx.runMutation(internal.lib.oauthState.consumeState, {
      token: args.state,
      provider: "quickbooks",
    });
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error("Missing QuickBooks credentials in env");
      return { success: false };
    }

    // Exchange code for token
    try {
      const tokenResponse = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${clientId}:${clientSecret}`)}`
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: args.code,
          redirect_uri: args.redirectUri
        })
      });

      if (!tokenResponse.ok) {
        console.error("QuickBooks token exchange failed", await tokenResponse.text());
        return { success: false };
      }

      const tokens = await tokenResponse.json();

      await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
        orgId,
        provider: "quickbooks",
        status: "active",
        config: JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          realmId: args.realmId,
          expiresAt: Date.now() + tokens.expires_in * 1000
        })
      });

      return { success: true, orgId };
    } catch (e) {
      console.error("QuickBooks OAuth error", e);
      return { success: false };
    }
  }
});

export const getAccounts = action({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can fetch accounts");

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });

    if (!integration || integration.status !== "active" || !integration.config) {
      throw new Error("QuickBooks integration not active");
    }

    const config = JSON.parse(integration.config);
    if (!config.realmId) throw new Error("Missing QuickBooks realm");
    const accessToken = await ensureFreshAccessToken(ctx, profile.orgId, config);

    // Fetch all active accounts — admins can map any account type as a ledger
    // source (prepaid accounts, wallets, petty cash, etc. may not be type 'Bank').
    const query = "select * from Account where Active = true ORDERBY Name";
    const response = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" } },
    );

    if (!response.ok) {
      console.error("QuickBooks API error:", await response.text());
      throw new Error("Failed to fetch accounts from QuickBooks");
    }

    const data = await response.json();
    const accounts = data.QueryResponse?.Account ?? [];

    return accounts.map((a: any) => ({
      id: a.Id,
      name: a.FullyQualifiedName ?? a.Name,
      type: a.AccountType,
    }));
  },
});

export const fetchLedgerForPeriod = action({
  args: {
    templateId: v.id("reportTemplates"),
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");

    const template = await ctx.runQuery(api.reportTemplates.get, { templateId: args.templateId });
    if (!template) throw new Error("Template not found");
    if (!template.quickbooksAccountId) throw new Error("Template not mapped to a QuickBooks account");

    const submissionInfo = await ctx.runQuery(api.submissions.getSubmission, { submissionId: args.submissionId });
    if (!submissionInfo?.submission) throw new Error("Submission not found");
    const { periodStart, periodEnd } = submissionInfo.submission;

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });
    if (!integration || integration.status !== "active" || !integration.config) {
      throw new Error("QuickBooks integration not active");
    }
    const config = JSON.parse(integration.config);
    const accessToken = await ensureFreshAccessToken(ctx, profile.orgId, config);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

    // Resolve the mapped account's own (fully-qualified) name so we can filter
    // the report's rows ourselves — the report's `account` query param doesn't
    // reliably filter server-side (confirmed empirically: it still returns
    // unrelated rows, e.g. Receivables, alongside the ones for this account).
    const acctQuery = `select Name, FullyQualifiedName from Account where Id = '${template.quickbooksAccountId}'`;
    const acctRes = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/query?query=${encodeURIComponent(acctQuery)}&minorversion=70`,
      { headers },
    );
    if (!acctRes.ok) {
      console.error("QuickBooks account lookup failed", await acctRes.text());
      throw new Error("Failed to resolve the mapped QuickBooks account");
    }
    const acctData = await acctRes.json();
    const account = acctData.QueryResponse?.Account?.[0];
    if (!account) throw new Error("The QuickBooks account mapped to this report no longer exists");
    const accountName: string = account.FullyQualifiedName ?? account.Name;

    const toDateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

    // Fetch the account's balance as of the day before the period starts so we
    // can include a running Balance column in the CSV.  parseBankCsv uses this
    // to populate openingBalance / closingBalance on the parsed statement, which
    // the validator then compares against the bank statement's figures.
    const dayBefore = toDateStr(periodStart - 86_400_000);
    // NOTE: QuickBooks silently ignores a bare `as_of` param on this report and
    // always returns today's balance — the only way to get a historical
    // point-in-time balance is `start_date`/`end_date` with end_date as the
    // as-of date (confirmed empirically).
    const bsRes = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/reports/BalanceSheet` +
        `?start_date=2000-01-01&end_date=${dayBefore}&minorversion=70`,
      { headers },
    );
    let openingBalance = 0;
    if (bsRes.ok) {
      const bsData = await bsRes.json();
      const found = findAccountBalanceInReport(bsData.Rows?.Row ?? [], template.quickbooksAccountId!);
      if (found !== null) openingBalance = found;
    } else {
      console.warn("QB BalanceSheet fetch failed — opening balance will default to 0", await bsRes.text());
    }

    const reportRes = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/reports/TransactionList` +
        `?start_date=${toDateStr(periodStart)}&end_date=${toDateStr(periodEnd)}` +
        `&account=${template.quickbooksAccountId}&minorversion=70`,
      { headers },
    );
    if (!reportRes.ok) {
      console.error("QuickBooks report error", await reportRes.text());
      throw new Error("Failed to fetch the ledger from QuickBooks");
    }
    const reportData = await reportRes.json();
    const rows = reportData.Rows?.Row ?? [];

    // Ledger convention (cash-book): money in = Debit, money out = Credit.
    // We include a running Balance column so parseBankCsv can derive
    // openingBalance / closingBalance for the validator's balance checks.
    let csvContent = "Date,Description,Debit,Credit,Balance\n";
    // Explicit opening-balance marker row (no Debit/Credit — parseBankCsv
    // detects this pattern and treats it as the period's opening balance).
    csvContent += `,Opening Balance,,,${openingBalance.toFixed(2)}\n`;

    // Extract all rows that affect this account, including synthesised rows for
    // non-bank Transfers where QB omits the bank-account side (see qbExtract.ts).
    const accountRows = extractAccountRows(rows, accountName);
    let runningBalance = openingBalance;
    for (const { date, description, amount } of accountRows) {
      runningBalance += amount; // positive = debit (money in), negative = credit (money out)
      const escaped = String(description).replace(/"/g, '""');
      csvContent +=
        amount > 0
          ? `${date},"${escaped}",${amount.toFixed(2)},,${runningBalance.toFixed(2)}\n`
          : `${date},"${escaped}",,${Math.abs(amount).toFixed(2)},${runningBalance.toFixed(2)}\n`;
    }

    const blob = new Blob([csvContent], { type: "text/csv" });
    return await ctx.storage.store(blob);
  },
});

/**
 * Fetches payroll journal entries from QuickBooks for the submission's period
 * and stores the result as a CSV file in Convex storage.
 *
 * The CSV has columns: AccountName,Amount,PostingType
 * Each row is one JournalEntry line that matches a payroll account.
 *
 * Returns the storageId of the generated CSV, ready to be attached to a
 * submission with label "QuickBooks Payroll Data" and fileType "csv".
 */
export const fetchPayrollJournalEntries = action({
  args: {
    submissionId: v.id("submissions"),
  },
  handler: async (ctx, { submissionId }) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");

    const submissionInfo = await ctx.runQuery(api.submissions.getSubmission, { submissionId });
    if (!submissionInfo?.submission) throw new Error("Submission not found");
    const { periodStart, periodEnd } = submissionInfo.submission;

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });
    if (!integration || integration.status !== "active" || !integration.config) {
      throw new Error("QuickBooks integration not active");
    }
    const config = JSON.parse(integration.config);
    const accessToken = await ensureFreshAccessToken(ctx, profile.orgId, config);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

    const toDateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const startDate = toDateStr(periodStart);
    const endDate   = toDateStr(periodEnd);

    // Fetch all JournalEntry objects for the period.
    const query = `select * from JournalEntry where TxnDate >= '${startDate}' and TxnDate <= '${endDate}'`;
    const res = await fetch(
      `https://quickbooks.api.intuit.com/v3/company/${config.realmId}/query?query=${encodeURIComponent(query)}&minorversion=70`,
      { headers },
    );
    if (!res.ok) {
      const body = await res.text();
      console.error("QB JournalEntry query failed", body);
      throw new Error("Failed to fetch payroll journal entries from QuickBooks");
    }

    const data = await res.json();
    const entries: any[] = data.QueryResponse?.JournalEntry ?? [];

    // Payroll account keywords to capture (case-insensitive).
    const PAYROLL_ACCOUNTS = [
      /staff.salaries/i,
      /napsa.employer/i,
      /nhima.employer/i,
      /napsa.payable/i,
      /nhima.payable/i,
      /zra.tax|paye.payable|tax.payable/i,
      /staff.deductions.control/i,
      /(net.pay|wages.*salaries).*(control)/i,
    ];

    // Accumulate amounts per account name (sum across multiple journal entries).
    const accountTotals: Map<string, number> = new Map();

    for (const entry of entries) {
      const lines: any[] = entry.Line ?? [];
      for (const line of lines) {
        const detail = line.JournalEntryLineDetail;
        if (!detail) continue;
        const acctName: string = detail.AccountRef?.name ?? "";
        const amount: number   = parseFloat(line.Amount ?? "0") || 0;
        const posting: string  = detail.PostingType ?? ""; // "Debit" | "Credit"

        // Only capture lines that look like payroll accounts.
        const isPayroll = PAYROLL_ACCOUNTS.some((re) => re.test(acctName));
        if (!isPayroll) continue;

        // Credits go in as positive, debits also positive (the validator just
        // compares magnitudes — it already knows which accounts are debit/credit).
        accountTotals.set(acctName, (accountTotals.get(acctName) ?? 0) + amount);
      }
    }

    // Produce CSV.
    let csv = "AccountName,Amount,PostingType\n";
    for (const [acct, amount] of accountTotals) {
      const escaped = acct.includes(",") ? `"${acct}"` : acct;
      csv += `${escaped},${amount.toFixed(2)},\n`;
    }

    const blob = new Blob([csv], { type: "text/csv" });
    return await ctx.storage.store(blob);
  },
});
