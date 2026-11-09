"use node";

import { randomBytes, createHash } from "crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MWP_BASE_URL = "https://moneywise.blueopus.cloud/api/v1";
const MWP_AUTH_URL = "https://moneywise.blueopus.cloud/oauth/authorize";
// The token and revoke endpoints live on the API (under /api); only the consent page is on the web app.
const MWP_TOKEN_URL = "https://moneywise.blueopus.cloud/api/oauth/token";
const MWP_REVOKE_URL = "https://moneywise.blueopus.cloud/api/oauth/revoke";
// read: organisation, wallets, balance, transactions, accounts, requisitions, products, payment links.
// write: create payment links (and products).
const MWP_SCOPE = "read write";

// ── PKCE helpers ──────────────────────────────────────────────────────────────

function generateVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// ── Config types ──────────────────────────────────────────────────────────────

type OAuthConfig = {
  authMethod: "oauth";
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  orgName: string;
};

type ApiKeyConfig = {
  authMethod: "apikey";
  apiKey: string;
  orgName: string;
};

type StoredConfig = (OAuthConfig | ApiKeyConfig) & { refreshingAt?: number };

// ── Shared fetch helper ───────────────────────────────────────────────────────

function mwpHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

async function mwpFetch(token: string, path: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(`${MWP_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...mwpHeaders(token),
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MoneyWise Pro API error ${res.status}: ${body}`);
  }
  return res.json();
}

// ── Token management ──────────────────────────────────────────────────────────

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

async function doTokenRefresh(
  cfg: OAuthConfig,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const clientId = process.env.MONEYWISE_CLIENT_ID;
  const clientSecret = process.env.MONEYWISE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("MONEYWISE_CLIENT_ID / MONEYWISE_CLIENT_SECRET not configured");
  }

  const res = await fetch(MWP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: cfg.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`refresh_rejected:${res.status}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/** Returns a valid Bearer token for the caller's org, refreshing if needed. */
async function getMwpToken(ctx: ActionCtx): Promise<{ token: string; orgId: Id<"organizations"> }> {
  const profile = await ctx.runQuery(api.profiles.getMe, {});
  if (!profile) throw new Error("Not authenticated");
  return { token: await tokenForOrg(ctx, profile.orgId), orgId: profile.orgId };
}

/** Returns a valid Bearer token for an org's MoneyWise connection, refreshing if needed — for background jobs with no signed-in user. */
async function tokenForOrg(ctx: ActionCtx, orgId: Id<"organizations">): Promise<string> {
  const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
    orgId,
    provider: "moneywise",
  });
  if (!integration || integration.status !== "active" || !integration.config) {
    throw new Error("MoneyWise Pro is not connected");
  }

  const cfg = JSON.parse(integration.config) as StoredConfig;

  // API-key path — always valid
  if (cfg.authMethod === "apikey") {
    if (!cfg.apiKey) throw new Error("MoneyWise Pro API key missing — please reconnect.");
    return cfg.apiKey;
  }

  // OAuth path — check expiry
  if (!cfg.accessToken || !cfg.refreshToken) {
    throw new Error("MoneyWise Pro tokens missing — please reconnect.");
  }

  const needsRefresh = !cfg.expiresAt || cfg.expiresAt - Date.now() < REFRESH_BUFFER_MS;
  if (!needsRefresh) {
    return cfg.accessToken;
  }

  // Acquire the refresh lock (Convex mutation is serialised — safe)
  const lock = await ctx.runMutation(internal.integrations.acquireRefreshLock, {
    orgId,
    provider: "moneywise",
  });

  if (!lock.acquired) {
    // Another action is refreshing; use the current token if it hasn't expired yet
    const current = lock.accessToken ?? cfg.accessToken;
    if (cfg.expiresAt && cfg.expiresAt > Date.now()) return current;
    throw new Error("Token refresh in progress — please retry in a moment.");
  }

  // We hold the lock — do the HTTP refresh
  const siteUrl =
    process.env.SITE_URL ??
    process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
    "";
  const redirectUri = `${siteUrl}/api/moneywise/callback`;

  try {
    const tokens = await doTokenRefresh(cfg, redirectUri);
    await ctx.runMutation(internal.integrations.saveRefreshedTokens, {
      orgId,
      provider: "moneywise",
      ...tokens,
    });
    return tokens.accessToken;
  } catch {
    // Refresh refused → disconnect so the UI shows the reconnect prompt
    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId,
      provider: "moneywise",
      status: "disconnected",
      config: JSON.stringify({}),
    });
    throw new Error("MoneyWise Pro session expired — please reconnect.");
  }
}

// ── Recon helper (no user auth required) ─────────────────────────────────────

export const fetchTransactionsForRecon = internalAction({
  args: { from: v.string(), to: v.string(), orgId: v.optional(v.id("organizations")) },
  handler: async (ctx, { from, to, orgId }): Promise<unknown> => {
    const integration = orgId
      ? await ctx.runQuery(internal.integrations.getInternalIntegration, { orgId, provider: "moneywise" })
      : await ctx.runQuery(internal.integrations.getActiveMoneyWise, {});
    if (!integration?.config || integration.status !== "active") throw new Error("No active MoneyWise integration found");

    const cfg = JSON.parse(integration.config) as StoredConfig;

    let token: string;
    if (cfg.authMethod === "apikey") {
      token = cfg.apiKey;
    } else {
      const needsRefresh = !cfg.expiresAt || cfg.expiresAt - Date.now() < REFRESH_BUFFER_MS;
      if (needsRefresh) {
        const siteUrl = process.env.SITE_URL ?? process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
        const redirectUri = `${siteUrl}/api/moneywise/callback`;
        const tokens = await doTokenRefresh(cfg, redirectUri);
        await ctx.runMutation(internal.integrations.saveRefreshedTokens, {
          orgId: integration.orgId,
          provider: "moneywise",
          ...tokens,
        });
        token = tokens.accessToken;
      } else {
        token = cfg.accessToken;
      }
    }
    if (!token) throw new Error("MoneyWise token missing — please reconnect");

    // 1. List external wallets (Zanaco, Natsave, etc.)
    const externalWallets = await mwpFetch(token, "/external-wallets").catch(() => null) as {
      data?: Array<{ id: string; name: string; bank?: string; currency?: string; ledger_balance?: number }>;
      count?: number;
    } | null;

    // 2. Find the Zanaco external wallet
    const zanacoWallet = externalWallets?.data?.find((w) =>
      w.name?.toLowerCase().includes("zanaco") || w.bank?.toLowerCase().includes("zanaco")
    );

    // 3. Fetch all ledger transactions recorded against the Zanaco external wallet
    const mwLedgerEntries: unknown[] = [];
    if (zanacoWallet?.id) {
      let cursor: string | undefined;
      do {
        const params = new URLSearchParams({
          external_wallet_id: zanacoWallet.id,
          start_date: from,
          end_date: to,
          limit: "200",
        });
        if (cursor) params.set("cursor", cursor);
        const page = await mwpFetch(token, `/transactions?${params.toString()}`) as {
          data?: unknown[];
          next_cursor?: string;
        };
        mwLedgerEntries.push(...(page.data ?? []));
        cursor = page.next_cursor;
      } while (cursor);
    }

    const organization = await mwpFetch(token, "/organization").catch(() => null);
    const allMwIntegrations = await ctx.runQuery(internal.integrations.listAllMoneyWise, {});
    return { organization, allMwIntegrations, externalWallets, zanacoWalletId: zanacoWallet?.id ?? null, mwLedgerEntries };
  },
});

// ── OAuth connect flow ────────────────────────────────────────────────────────

export const getAuthUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, { redirectUri }): Promise<string> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const clientId = process.env.MONEYWISE_CLIENT_ID;
    if (!clientId) throw new Error("MONEYWISE_CLIENT_ID is not configured on the server.");

    const verifier = generateVerifier();
    const challenge = generateChallenge(verifier);

    const state = await ctx.runMutation(internal.lib.oauthState.createState, {
      orgId: profile.orgId,
      provider: "moneywise",
      codeVerifier: verifier,
    });

    const url = new URL(MWP_AUTH_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", MWP_SCOPE);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  },
});

type CallbackResult = { success: true; orgId: Id<"organizations"> } | { success: false };

export const handleCallback = internalAction({
  args: { code: v.string(), state: v.string(), redirectUri: v.string() },
  handler: async (ctx, { code, state, redirectUri }): Promise<CallbackResult> => {
    const clientId = process.env.MONEYWISE_CLIENT_ID;
    const clientSecret = process.env.MONEYWISE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      console.error("MoneyWise Pro: missing MONEYWISE_CLIENT_ID / MONEYWISE_CLIENT_SECRET");
      return { success: false };
    }

    let orgId: Id<"organizations">;
    let codeVerifier: string | undefined;
    try {
      const result = await ctx.runMutation(internal.lib.oauthState.consumeStateWithVerifier, {
        token: state,
        provider: "moneywise",
      });
      orgId = result.orgId;
      codeVerifier = result.codeVerifier;
    } catch (e) {
      console.error("MoneyWise Pro callback: invalid state", e);
      return { success: false };
    }

    // Exchange code for tokens
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
    });

    const tokenRes = await fetch(MWP_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      console.error("MoneyWise Pro token exchange failed", tokenRes.status);
      return { success: false };
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Fetch org name
    const orgRes = await fetch(`${MWP_BASE_URL}/organization`, {
      headers: mwpHeaders(tokens.access_token),
    });
    const orgData = orgRes.ok
      ? ((await orgRes.json()) as { name?: string })
      : { name: "" };

    const config: OAuthConfig = {
      authMethod: "oauth",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      orgName: orgData.name ?? "",
    };

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId,
      provider: "moneywise",
      status: "active",
      config: JSON.stringify(config),
    });

    return { success: true, orgId };
  },
});

// ── Manual API-key fallback ───────────────────────────────────────────────────

/** Direct connect using a service account API key — for orgs without OAuth. */
export const connect = action({
  args: { apiKey: v.string() },
  handler: async (ctx, { apiKey }): Promise<{ orgName: string }> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const testRes = await fetch(`${MWP_BASE_URL}/organization`, {
      headers: mwpHeaders(apiKey),
    });
    if (testRes.status === 401)
      throw new Error("Invalid API key — rejected by MoneyWise Pro.");
    if (testRes.status === 403)
      throw new Error("Access denied — check your MoneyWise Pro account permissions.");
    if (!testRes.ok)
      throw new Error(`MoneyWise Pro returned ${testRes.status}. Check credentials and try again.`);

    const org = (await testRes.json()) as { name?: string };
    const orgName = org.name ?? "";

    const config: ApiKeyConfig = { authMethod: "apikey", apiKey, orgName };

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "moneywise",
      status: "active",
      config: JSON.stringify(config),
    });

    return { orgName };
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx): Promise<void> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can manage integrations");

    // Revoke the OAuth refresh token if present
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: profile.orgId,
      provider: "moneywise",
    });
    if (integration?.config) {
      try {
        const cfg = JSON.parse(integration.config) as Partial<OAuthConfig>;
        if (cfg.refreshToken) {
          const clientId = process.env.MONEYWISE_CLIENT_ID ?? "";
          const clientSecret = process.env.MONEYWISE_CLIENT_SECRET ?? "";
          await fetch(MWP_REVOKE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: cfg.refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
            }).toString(),
          }).catch(() => {}); // best-effort
        }
      } catch {}
    }

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "moneywise",
      status: "disconnected",
      config: JSON.stringify({}),
    });
  },
});

// ── Data endpoints ────────────────────────────────────────────────────────────

export const getOrganization = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/organization");
  },
});

export const listWallets = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/wallets");
  },
});

export const getBalance = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/balance");
  },
});

export const listTransactions = action({
  args: {
    cursor: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, from, to }): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return mwpFetch(token, `/transactions${qs ? `?${qs}` : ""}`);
  },
});

export const listAccounts = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/accounts");
  },
});

export const listRequisitions = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/requisitions");
  },
});

export const getRequisition = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, `/requisitions/${id}`);
  },
});

export const listProducts = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/products");
  },
});

export const listPaymentLinks = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/payment-links");
  },
});

export const createPaymentLink = action({
  args: {
    amount: v.number(),
    currency: v.string(),
    description: v.optional(v.string()),
    expiresAt: v.optional(v.string()),
  },
  handler: async (ctx, { amount, currency, description, expiresAt }): Promise<unknown> => {
    const { token } = await getMwpToken(ctx);
    return mwpFetch(token, "/payment-links", {
      method: "POST",
      body: JSON.stringify({
        amount,
        currency,
        ...(description ? { description } : {}),
        ...(expiresAt ? { expires_at: expiresAt } : {}),
      }),
    });
  },
});

// ── Daily reconciliation feed ─────────────────────────────────────────────────

/**
 * Every MoneyWise transaction dated `date` (YYYY-MM-DD) for an org, raw as the
 * API returns them — the reconciliation normalises them (lib/mew3/moneywise.ts).
 * Asks for the day either side as well, since the API's day boundary may be UTC
 * and the business runs on Lusaka time.
 */
/** MoneyWise's built-in ledgers: its own wallet, plus cash, Airtel Money and bank takings. */
const INTERNAL_LEDGERS = ["MONEYWISE_WALLET", "CASH", "AIRTEL_MONEY", "BANK"];

export const fetchDayTransactions = internalAction({
  args: { orgId: v.id("organizations"), date: v.string() },
  handler: async (ctx, { orgId, date }): Promise<unknown[]> => {
    const token = await tokenForOrg(ctx, orgId);
    const day = (offset: number) => new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
    // Each payment method is its own ledger in MoneyWise, and /transactions returns only the
    // MoneyWise Wallet one unless told otherwise; cash and Airtel sales live in the others.
    const external = (await mwpFetch(token, "/external-wallets").catch(() => null)) as { data?: Array<{ id: string }> } | null;
    const ledgers: Array<Record<string, string>> = [
      ...INTERNAL_LEDGERS.map((ledger) => ({ ledger })),
      ...(external?.data ?? []).map((w) => ({ external_wallet_id: w.id })),
    ];
    const txns: unknown[] = [];
    for (const which of ledgers) {
      let cursor: string | undefined;
      for (let page = 0; page < 50; page++) {
        const params = new URLSearchParams({ ...which, start_date: day(-1), end_date: day(1), limit: "200" });
        if (cursor) params.set("cursor", cursor);
        const res = (await mwpFetch(token, `/transactions?${params.toString()}`)) as
          | { data?: unknown[]; next_cursor?: string | null }
          | unknown[];
        if (Array.isArray(res)) {
          txns.push(...res);
          break;
        }
        txns.push(...(res.data ?? []));
        cursor = res.next_cursor ?? undefined;
        if (!cursor) break;
      }
    }
    return txns;
  },
});
// ── Sales ─────────────────────────────────────────────────────────────────────

/**
 * Records a sale in MoneyWise (POST /sales, `write` scope). Never throws: the
 * caller stores the outcome. A repeat of the same external_reference returns
 * the sale MoneyWise already has rather than creating another.
 */
export const postSale = internalAction({
  args: { orgId: v.id("organizations"), body: v.string() },
  handler: async (ctx, { orgId, body }): Promise<{ ok: true; ref: string } | { ok: false; error: string }> => {
    let token: string;
    try {
      token = await tokenForOrg(ctx, orgId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    const res = await fetch(`${MWP_BASE_URL}/sales`, { method: "POST", headers: { ...mwpHeaders(token), "Content-Type": "application/json" }, body });
    const text = await res.text().catch(() => "");
    let json: { data?: { receipt_number?: string; id?: string }; error?: string; message?: string } = {};
    try {
      json = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    if (res.ok) return { ok: true, ref: json.data?.receipt_number ?? json.data?.id ?? "posted" };
    if (res.status === 404 || res.status === 405) return { ok: false, error: "MoneyWise doesn't accept sales over the API yet (POST /sales is not live)." };
    if (res.status === 401 || res.status === 403) return { ok: false, error: "MoneyWise refused: the connection needs the write permission. Reconnect MoneyWise with write access." };
    return { ok: false, error: `MoneyWise ${res.status}: ${(json.error ?? json.message ?? text).slice(0, 300)}` };
  },
});

