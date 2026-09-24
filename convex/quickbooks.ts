"use node";

import { action, internalAction, internalMutation, mutation, query } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { extractAccountRows } from "./lib/qbExtract";
import { Composio } from "@composio/core";

function getComposioClient() {
  return new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? "" });
}

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
  config: { accessToken: string; refreshToken: string; expiresAt: number; realmId?: string; composioConnectionId?: string },
): Promise<string> {
  const REFRESH_BUFFER_MS = 5 * 60 * 1000;
  const isExpiredOrExpiring = !config.expiresAt || Date.now() >= config.expiresAt - REFRESH_BUFFER_MS;

  if (!isExpiredOrExpiring && config.accessToken) {
    return config.accessToken;
  }

  // When connected via Composio, try delegating refresh to Composio
  if (config.composioConnectionId) {
    const composioKey = process.env.COMPOSIO_API_KEY;
    if (composioKey) {
      try {
        const composio = getComposioClient();
        await composio.connectedAccounts.refresh(config.composioConnectionId);
        const account = await composio.connectedAccounts.get(config.composioConnectionId);
        const rawAccount = account as any;
        const stateVal = account.state?.authScheme === "OAUTH2" ? (account.state.val as any) : undefined;
        const dataObj = rawAccount.data ?? {};
        const paramsObj = rawAccount.params ?? {};

        const newAccessToken: string | undefined =
          stateVal?.access_token ??
          dataObj.access_token ??
          paramsObj.access_token ??
          rawAccount.access_token;

        const newRefreshToken: string | undefined =
          stateVal?.refresh_token ??
          dataObj.refresh_token ??
          paramsObj.refresh_token ??
          rawAccount.refresh_token ??
          config.refreshToken;

        const expiresInRaw =
          stateVal?.expires_in ??
          dataObj.expires_in ??
          paramsObj.expires_in ??
          rawAccount.expires_in;
        const expiresIn: number = expiresInRaw ? parseInt(String(expiresInRaw)) : 3600;

        if (newAccessToken) {
          const newConfig = { ...config, accessToken: newAccessToken, refreshToken: newRefreshToken ?? config.refreshToken, expiresAt: Date.now() + expiresIn * 1000 };
          await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
            orgId, provider: "quickbooks", status: "active", config: JSON.stringify(newConfig),
          });
          return newAccessToken;
        }
      } catch (e) {
        console.warn("Composio token refresh attempt warning", e);
      }
    }
  }

  // Direct Intuit OAuth refresh fallback
  const clientId = process.env.QUICKBOOKS_CLIENT_ID;
  const clientSecret = process.env.QUICKBOOKS_CLIENT_SECRET;
  if (clientId && clientSecret && config.refreshToken) {
    try {
      const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: config.refreshToken }),
      });

      if (res.ok) {
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
      } else {
        const errText = await res.text();
        console.error("Direct Intuit token refresh failed", res.status, errText);
      }
    } catch (e) {
      console.warn("Direct Intuit token refresh attempt warning", e);
    }
  }

  // Fallback to existing accessToken only if it is NOT strictly expired yet
  if (config.accessToken && config.expiresAt && Date.now() < config.expiresAt) {
    return config.accessToken;
  }

  throw new Error("QuickBooks connection expired — please reconnect it from the Integrations Hub.");
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
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    // Composio-managed OAuth flow (Preferred)
    const composioKey = process.env.COMPOSIO_API_KEY;
    if (composioKey) {
      const composio = getComposioClient();
      const existingConfigs = await composio.authConfigs.list({ toolkit: "quickbooks" });
      // Only reuse a Composio-managed config — custom configs may have been created
      // with placeholder credentials (e.g. "your_value") and will fail at Intuit.
      const managedConfig = existingConfigs.items.find((c) => c.isComposioManaged);
      const authConfigId =
        managedConfig?.id ?? (await composio.authConfigs.create("quickbooks")).id;

      // Use a separate callback URL so the handler knows this came from Composio.
      // Encode the orgId in the URL so the callback can resolve it without needing
      // it from the Composio response (ConnectedAccountRetrieveResponse has no userId).
      const composioCallbackUrl =
        args.redirectUri.replace("/api/quickbooks/callback", "/api/quickbooks/composio-callback") +
        `?orgId=${profile.orgId}`;

      const connectionRequest = await composio.connectedAccounts.link(
        profile.orgId,
        authConfigId,
        { callbackUrl: composioCallbackUrl, allowMultiple: true },
      );

      if (!connectionRequest.redirectUrl) throw new Error("Composio did not return an OAuth URL");
      return connectionRequest.redirectUrl;
    }

    // Direct Intuit OAuth fallback
    const clientId = process.env.QUICKBOOKS_CLIENT_ID;
    if (clientId) {
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

    throw new Error("QuickBooks integration not configured (missing COMPOSIO_API_KEY)");
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

export const handleComposioCallback = internalAction({
  args: {
    connectedAccountId: v.string(),
    orgId: v.id("organizations"),
    realmId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<CallbackResult> => {
    const composioKey = process.env.COMPOSIO_API_KEY;
    if (!composioKey) {
      console.error("COMPOSIO_API_KEY not set in environment");
      return { success: false };
    }

    try {
      const composio = getComposioClient();

      let account = await composio.connectedAccounts.get(args.connectedAccountId);
      let attempts = 0;
      let accessToken: string | undefined;
      let refreshToken: string | undefined;
      let realmId: string | undefined;
      let expiresIn: number = 3600;

      while (attempts < 4) {
        const rawAccount = account as any;
        const stateVal = account.state?.authScheme === "OAUTH2" ? (account.state.val as any) : undefined;
        const dataObj = rawAccount.data ?? {};
        const paramsObj = rawAccount.params ?? {};
        const connectionParams = rawAccount.connectionParams ?? {};

        accessToken =
          stateVal?.access_token ??
          dataObj.access_token ??
          paramsObj.access_token ??
          rawAccount.access_token;

        refreshToken =
          stateVal?.refresh_token ??
          dataObj.refresh_token ??
          paramsObj.refresh_token ??
          rawAccount.refresh_token ??
          undefined;

        realmId =
          stateVal?.realmId ??
          stateVal?.realm_id ??
          stateVal?.full?.realmId ??
          stateVal?.full?.realm_id ??
          dataObj.realmId ??
          dataObj.realm_id ??
          dataObj.generic_id ??
          (stateVal?.generic_id as string | undefined) ??
          paramsObj.realmId ??
          paramsObj.realm_id ??
          connectionParams.realmId ??
          connectionParams.realm_id ??
          rawAccount.realmId ??
          rawAccount.realm_id ??
          rawAccount.generic_id ??
          args.realmId;

        const expiresInRaw =
          stateVal?.expires_in ??
          dataObj.expires_in ??
          paramsObj.expires_in ??
          rawAccount.expires_in;
        if (expiresInRaw) expiresIn = parseInt(String(expiresInRaw));

        if (accessToken && realmId) {
          break;
        }

        attempts++;
        if (attempts < 4) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          try {
            await composio.connectedAccounts.refresh(args.connectedAccountId);
          } catch {}
          account = await composio.connectedAccounts.get(args.connectedAccountId);
        }
      }

      if (!accessToken || !realmId) {
        console.error("Composio QB callback: failed to resolve access_token or realmId after retries", {
          accountStatus: account.status,
          hasAccessToken: !!accessToken,
          hasRealmId: !!realmId,
          argsRealmId: args.realmId,
        });

        if (account.status !== "ACTIVE" && !accessToken) {
          return { success: false };
        }
      }

      await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
        orgId: args.orgId,
        provider: "quickbooks",
        status: "active",
        config: JSON.stringify({
          accessToken: accessToken ?? "",
          refreshToken: refreshToken ?? "",
          realmId: realmId ?? "",
          expiresAt: Date.now() + expiresIn * 1000,
          composioConnectionId: args.connectedAccountId,
        }),
      });

      return { success: true, orgId: args.orgId };
    } catch (e) {
      console.error("Composio QB callback error", e);
      return { success: false };
    }
  },
});

/**
 * Helper to execute an Intuit API request with automatic production/sandbox endpoint fallback.
 */
async function fetchIntuitApi(
  realmId: string,
  pathAndQuery: string,
  accessToken: string,
): Promise<Response> {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const prodUrl = `https://quickbooks.api.intuit.com/v3/company/${realmId}/${pathAndQuery}`;
  let res = await fetch(prodUrl, { headers });

  if (!res.ok && (res.status === 401 || res.status === 400 || res.status === 403)) {
    const sandboxUrl = `https://sandbox-quickbooks.api.intuit.com/v3/company/${realmId}/${pathAndQuery}`;
    const sandboxRes = await fetch(sandboxUrl, { headers });
    if (sandboxRes.ok) {
      return sandboxRes;
    }
  }

  return res;
}

/**
 * Resolves (and persists) the organization's QuickBooks realmId if missing from config.
 */
async function resolveRealmIdIfNeeded(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  config: any,
): Promise<string> {
  if (config.realmId) return config.realmId;

  if (config.composioConnectionId && process.env.COMPOSIO_API_KEY) {
    try {
      const composio = getComposioClient();
      const account = await composio.connectedAccounts.get(config.composioConnectionId);
      const rawAccount = account as any;
      const stateVal = account.state?.authScheme === "OAUTH2" ? (account.state.val as any) : undefined;
      const dataObj = rawAccount.data ?? {};
      const paramsObj = rawAccount.params ?? {};
      const connectionParams = rawAccount.connectionParams ?? {};

      const extraTokenData = (stateVal?.extra_token_data as Record<string, unknown>) ?? {};
      const resolvedRealmId: string | undefined =
        stateVal?.realmId ??
        stateVal?.realm_id ??
        stateVal?.full?.realmId ??
        stateVal?.full?.realm_id ??
        (extraTokenData.realmId as string | undefined) ??
        (extraTokenData.realm_id as string | undefined) ??
        dataObj.realmId ??
        dataObj.realm_id ??
        dataObj.generic_id ??
        (stateVal?.generic_id as string | undefined) ??
        paramsObj.realmId ??
        paramsObj.realm_id ??
        connectionParams.realmId ??
        connectionParams.realm_id ??
        rawAccount.realmId ??
        rawAccount.realm_id ??
        rawAccount.generic_id;

      console.log("resolveRealmIdIfNeeded Composio lookup", {
        found: !!resolvedRealmId,
        stateAuthScheme: account.state?.authScheme,
        stateStatus: stateVal?.status,
        stateKeys: stateVal ? Object.keys(stateVal) : [],
        extraTokenDataKeys: Object.keys(extraTokenData),
        dataKeys: Object.keys(dataObj),
        rawAccountTopKeys: Object.keys(rawAccount).filter(k => !["state", "data", "params"].includes(k)),
      });

      if (resolvedRealmId) {
        config.realmId = resolvedRealmId;
        await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
          orgId,
          provider: "quickbooks",
          status: "active",
          config: JSON.stringify(config),
        });
        return resolvedRealmId;
      }
    } catch (e) {
      console.warn("Failed to resolve missing realmId from Composio", e);
    }
  }

  throw new Error("Missing QuickBooks realm ID — please reconnect QuickBooks from the Integrations Hub.");
}


/**
 * Syncs the latest access/refresh tokens from Composio into our integration config.
 * Returns the fresh access token so callers can use it immediately.
 * Falls back silently if Composio can't provide a token.
 */
export const syncTokenFromComposio = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId, provider: "quickbooks",
    });
    if (!integration?.config) return null;
    const config = JSON.parse(integration.config);
    if (!config.composioConnectionId || !process.env.COMPOSIO_API_KEY) return null;
    try {
      const composio = getComposioClient();
      // Trigger a fresh token from Composio before reading the state.
      try {
        await (composio.connectedAccounts as any).refresh(config.composioConnectionId);
      } catch (refreshErr) {
        console.warn("[syncTokenFromComposio] Composio refresh call failed:", refreshErr);
      }
      const account = await composio.connectedAccounts.get(config.composioConnectionId);
      const raw = account as any;
      const state = raw.state ?? {};
      const stateVal = state.authScheme === "OAUTH2" ? (state.val ?? {}) : state.val ?? {};
      const dataObj = raw.data ?? stateVal ?? {};

      const freshAccessToken: string | undefined =
        stateVal?.access_token ?? dataObj?.access_token;
      const freshRefreshToken: string | undefined =
        stateVal?.refresh_token ?? dataObj?.refresh_token;
      const freshExpiresIn: number | undefined =
        stateVal?.expires_in ?? dataObj?.expires_in;

      if (!freshAccessToken) return null;

      const newConfig = {
        ...config,
        accessToken: freshAccessToken,
        ...(freshRefreshToken ? { refreshToken: freshRefreshToken } : {}),
        ...(freshExpiresIn ? { expiresAt: Date.now() + Number(freshExpiresIn) * 1000 } : {}),
      };
      await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
        orgId,
        provider: "quickbooks",
        status: "active",
        config: JSON.stringify(newConfig),
      });
      return freshAccessToken;
    } catch (e) {
      console.warn("[syncTokenFromComposio] Failed:", e);
      return null;
    }
  },
});

/** Dumps the raw Composio state for debugging (helps find realmId). */
export const dumpComposioState = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId, provider: "quickbooks",
    });
    if (!integration?.config) throw new Error("QB integration not found");
    const config = JSON.parse(integration.config);
    if (!config.composioConnectionId) return { error: "no composioConnectionId" };
    const composio = getComposioClient();
    const account = await composio.connectedAccounts.get(config.composioConnectionId);
    const raw = account as any;
    const state = raw.state ?? {};
    const stateVal = state.authScheme === "OAUTH2" ? (state.val ?? {}) : {};
    return {
      status: raw.status,
      stateStatus: stateVal.status,
      fullContent: stateVal.full ?? null,
      extraTokenData: stateVal.extra_token_data ?? null,
      data: raw.data ?? null,
    };
  },
});

/** Returns all active QB accounts via Composio CDC (no direct token needed). */
export const fetchChangedEntities = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const composio = getComposioClient();
    const result = await (composio as any).tools.execute(
      "QUICKBOOKS_GET_CHANGED_ENTITIES",
      {
        userId: orgId,
        arguments: { entities: "Account", changedSince: "2000-01-01T00:00:00Z" },
        dangerouslySkipVersionCheck: true,
      },
    );
    if (!result?.successful) return [];
    const queryResponses: any[] = result.data?.CDCResponse?.flatMap((cr: any) =>
      Array.isArray(cr.QueryResponse) ? cr.QueryResponse : [cr.QueryResponse]
    ) ?? [];
    const accounts: any[] = queryResponses.flatMap((qr: any) => qr?.Account ?? []);
    return accounts.filter((a: any) => a.Active !== false);
  },
});

/** Fetches a QB TransactionList report for an account + date range via Composio. */
export const fetchTransactionListReport = internalAction({
  args: {
    orgId: v.id("organizations"),
    accountId: v.string(),
    startDate: v.string(),
    endDate: v.string(),
  },
  handler: async (ctx, { orgId, accountId, startDate, endDate }) => {
    const composio = getComposioClient();
    const result = await (composio as any).tools.execute(
      "QUICKBOOKS_GET_TRANSACTION_LIST_REPORT",
      {
        userId: orgId,
        arguments: { account_ids: [accountId], start_date: startDate, end_date: endDate },
        dangerouslySkipVersionCheck: true,
      },
    );
    if (!result?.successful) throw new Error(`QB TransactionList failed: ${JSON.stringify(result?.error ?? result)}`);
    return result.data ?? result;
  },
});

/** Fetches a QB BalanceSheet report for a given date via Composio. */
export const fetchBalanceSheetReport = internalAction({
  args: {
    orgId: v.id("organizations"),
    reportDate: v.string(),
  },
  handler: async (ctx, { orgId, reportDate }) => {
    const composio = getComposioClient();
    const result = await (composio as any).tools.execute(
      "QUICKBOOKS_GET_BALANCE_SHEET_REPORT",
      {
        userId: orgId,
        arguments: { report_date: reportDate },
        dangerouslySkipVersionCheck: true,
      },
    );
    if (!result?.successful) throw new Error(`QB BalanceSheet failed: ${JSON.stringify(result?.error ?? result)}`);
    return result.data ?? result;
  },
});

/** Runs a QB API call against prod then sandbox, returning the parsed JSON. */
export const fetchQbJson = internalAction({
  args: { orgId: v.id("organizations"), pathAndQuery: v.string() },
  handler: async (ctx, { orgId, pathAndQuery }) => {
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId, provider: "quickbooks",
    });
    if (!integration?.config) throw new Error("QB integration not found");
    const config = JSON.parse(integration.config);
    if (!config.realmId) {
      config.realmId = await resolveRealmIdIfNeeded(ctx, orgId, config);
    }
    const accessToken = await ensureFreshAccessToken(ctx, orgId, config);
    const res = await fetchIntuitApi(config.realmId, pathAndQuery, accessToken);
    const text = await res.text();
    if (!res.ok) throw new Error(`QB API error: ${text}`);
    return JSON.parse(text);
  },
});

/** Gets a fresh QB access token for an org (used by backfillQbLedgers). */
export const getFreshToken = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId, provider: "quickbooks",
    });
    if (!integration?.config) throw new Error("QB integration not found");
    const config = JSON.parse(integration.config);
    return await ensureFreshAccessToken(ctx, orgId, config);
  },
});

/** Resolves and persists the realmId for an org's QB integration (used by backfillQbLedgers). */
export const resolveRealmId = internalAction({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId,
      provider: "quickbooks",
    });
    if (!integration || !integration.config) throw new Error("QB integration not found");
    const config = JSON.parse(integration.config);
    if (config.realmId) return config.realmId as string;
    return await resolveRealmIdIfNeeded(ctx, orgId, config);
  },
});

export const getAccounts = action({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.role !== "admin") return [];

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });

    if (!integration || integration.status !== "active" || !integration.config) {
      return [];
    }

    try {
      const config = JSON.parse(integration.config);

      // If we have a Composio connection, fetch accounts via Composio's CDC tool.
      // Composio manages the realmId internally, so we don't need it here.
      if (config.composioConnectionId && process.env.COMPOSIO_API_KEY) {
        try {
          const composio = getComposioClient();
          // Use changedSince epoch to get all accounts (CDC returns all records changed after this date).
          const result = await (composio as any).tools.execute("QUICKBOOKS_GET_CHANGED_ENTITIES", {
            userId: profile.orgId,
            arguments: { entities: "Account", changedSince: "2000-01-01T00:00:00Z" },
            dangerouslySkipVersionCheck: true,
          });
          if (result?.successful) {
            // CDCResponse is an array; QueryResponse within each item is also an array.
            const queryResponses: any[] = result.data?.CDCResponse?.flatMap((cr: any) =>
              Array.isArray(cr.QueryResponse) ? cr.QueryResponse : [cr.QueryResponse]
            ) ?? [];
            const accounts: any[] = queryResponses.flatMap((qr: any) => qr?.Account ?? []);
            const activeAccounts = accounts.filter((a: any) => a.Active !== false);
            activeAccounts.sort((a: any, b: any) => (a.FullyQualifiedName ?? a.Name).localeCompare(b.FullyQualifiedName ?? b.Name));
            return activeAccounts.map((a: any) => ({
              id: String(a.Id),
              name: a.FullyQualifiedName ?? a.Name,
              type: a.AccountType,
            }));
          }
          console.warn("Composio QUICKBOOKS_GET_CHANGED_ENTITIES failed:", result?.error);
        } catch (composioErr) {
          console.warn("Composio getAccounts fallback failed:", composioErr);
        }
      }

      // Direct Intuit API path (requires realmId stored in config).
      const realmId = await resolveRealmIdIfNeeded(ctx, profile.orgId, config);
      const accessToken = await ensureFreshAccessToken(ctx, profile.orgId, config);

      const query = "select * from Account where Active = true ORDERBY Name";
      const response = await fetchIntuitApi(
        realmId,
        `query?query=${encodeURIComponent(query)}&minorversion=70`,
        accessToken,
      );

      if (!response.ok) {
        const bodyText = await response.text();
        console.error("QuickBooks API error:", response.status, bodyText);

        if (response.status === 401 || response.status === 403) {
          await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
            orgId: profile.orgId,
            provider: "quickbooks",
            status: "disconnected",
            config: JSON.stringify({}),
          });
        }
        return [];
      }

      const data = await response.json();
      const accounts = data.QueryResponse?.Account ?? [];

      return accounts.map((a: any) => ({
        id: String(a.Id),
        name: a.FullyQualifiedName ?? a.Name,
        type: a.AccountType,
      }));
    } catch (e: any) {
      console.error("getAccounts error:", e);
      if (e.message?.includes("expired")) {
        await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
          orgId: profile.orgId,
          provider: "quickbooks",
          status: "disconnected",
          config: JSON.stringify({}),
        });
      }
      return [];
    }
  },
});

/**
 * Returns non-sensitive diagnostic info about the stored QB connection config.
 * Useful for debugging realmId / token issues without exposing credentials.
 */
export const debugConnection = action({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.role !== "admin") throw new Error("Unauthorized");

    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "quickbooks",
    });

    if (!integration) return { status: "no_integration" };

    let configDiag: Record<string, unknown> = { status: integration.status };
    if (integration.config) {
      try {
        const c = JSON.parse(integration.config);
        configDiag = {
          status: integration.status,
          hasAccessToken: !!c.accessToken,
          hasRefreshToken: !!c.refreshToken,
          realmId: c.realmId || "(empty)",
          expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
          expired: c.expiresAt ? Date.now() > c.expiresAt : null,
          composioConnectionId: c.composioConnectionId || null,
        };
      } catch {
        configDiag = { status: integration.status, configParseError: true };
      }
    }

    // If we have a Composio connection, also dump what Composio returns
    if (integration.config) {
      try {
        const c = JSON.parse(integration.config);
        if (c.composioConnectionId && process.env.COMPOSIO_API_KEY) {
          const composio = getComposioClient();
          const account = await composio.connectedAccounts.get(c.composioConnectionId);
          const rawAccount = account as any;
          const stateVal = account.state?.authScheme === "OAUTH2" ? (account.state.val as any) : undefined;
          configDiag.composio = {
            accountStatus: account.status,
            stateAuthScheme: account.state?.authScheme,
            stateStatus: stateVal?.status,
            stateKeys: stateVal ? Object.keys(stateVal) : [],
            extraTokenDataKeys: stateVal?.extra_token_data ? Object.keys(stateVal.extra_token_data) : [],
            dataKeys: rawAccount.data ? Object.keys(rawAccount.data) : [],
            rawTopKeys: Object.keys(rawAccount).filter(k => !["state", "data", "params"].includes(k)),
          };
        }
      } catch (e: any) {
        configDiag.composioError = e?.message;
      }
    }

    return configDiag;
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
    const realmId = await resolveRealmIdIfNeeded(ctx, profile.orgId, config);
    const accessToken = await ensureFreshAccessToken(ctx, profile.orgId, config);
    const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };

    // Resolve the mapped account's own (fully-qualified) name so we can filter
    // the report's rows ourselves — the report's `account` query param doesn't
    // reliably filter server-side (confirmed empirically: it still returns
    // unrelated rows, e.g. Receivables, alongside the ones for this account).
    const acctQuery = `select Name, FullyQualifiedName from Account where Id = '${template.quickbooksAccountId}'`;
    const acctRes = await fetchIntuitApi(
      realmId,
      `query?query=${encodeURIComponent(acctQuery)}&minorversion=70`,
      accessToken,
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
    const bsRes = await fetchIntuitApi(
      realmId,
      `reports/BalanceSheet?start_date=2000-01-01&end_date=${dayBefore}&minorversion=70`,
      accessToken,
    );
    let openingBalance = 0;
    if (bsRes.ok) {
      const bsData = await bsRes.json();
      const found = findAccountBalanceInReport(bsData.Rows?.Row ?? [], template.quickbooksAccountId!);
      if (found !== null) openingBalance = found;
    } else {
      console.warn("QB BalanceSheet fetch failed — opening balance will default to 0", await bsRes.text());
    }

    const reportRes = await fetchIntuitApi(
      realmId,
      `reports/TransactionList?start_date=${toDateStr(periodStart)}&end_date=${toDateStr(periodEnd)}&account=${template.quickbooksAccountId}&minorversion=70`,
      accessToken,
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
    const realmId = await resolveRealmIdIfNeeded(ctx, profile.orgId, config);
    const accessToken = await ensureFreshAccessToken(ctx, profile.orgId, config);

    const toDateStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const startDate = toDateStr(periodStart);
    const endDate   = toDateStr(periodEnd);

    // Fetch all JournalEntry objects for the period.
    const query = `select * from JournalEntry where TxnDate >= '${startDate}' and TxnDate <= '${endDate}'`;
    const res = await fetchIntuitApi(
      realmId,
      `query?query=${encodeURIComponent(query)}&minorversion=70`,
      accessToken,
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
