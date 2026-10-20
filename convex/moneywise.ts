"use node";

import { randomBytes, createHash } from "crypto";
import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MWP_BASE_URL = "https://moneywise.blueopus.cloud/api/v1";
const MWP_AUTH_URL = "https://moneywise.blueopus.cloud/oauth/authorize";
const MWP_TOKEN_URL = "https://moneywise.blueopus.cloud/oauth/token";
const MWP_REVOKE_URL = "https://moneywise.blueopus.cloud/oauth/revoke";

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

  const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
    orgId: profile.orgId,
    provider: "moneywise",
  });
  if (!integration || integration.status !== "active" || !integration.config) {
    throw new Error("MoneyWise Pro is not connected");
  }

  const cfg = JSON.parse(integration.config) as StoredConfig;

  // API-key path — always valid
  if (cfg.authMethod === "apikey") {
    if (!cfg.apiKey) throw new Error("MoneyWise Pro API key missing — please reconnect.");
    return { token: cfg.apiKey, orgId: profile.orgId };
  }

  // OAuth path — check expiry
  if (!cfg.accessToken || !cfg.refreshToken) {
    throw new Error("MoneyWise Pro tokens missing — please reconnect.");
  }

  const needsRefresh = !cfg.expiresAt || cfg.expiresAt - Date.now() < REFRESH_BUFFER_MS;
  if (!needsRefresh) {
    return { token: cfg.accessToken, orgId: profile.orgId };
  }

  // Acquire the refresh lock (Convex mutation is serialised — safe)
  const lock = await ctx.runMutation(internal.integrations.acquireRefreshLock, {
    orgId: profile.orgId,
    provider: "moneywise",
  });

  if (!lock.acquired) {
    // Another action is refreshing; use the current token if it hasn't expired yet
    const current = lock.accessToken ?? cfg.accessToken;
    if (cfg.expiresAt && cfg.expiresAt > Date.now()) return { token: current, orgId: profile.orgId };
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
      orgId: profile.orgId,
      provider: "moneywise",
      ...tokens,
    });
    return { token: tokens.accessToken, orgId: profile.orgId };
  } catch (e: any) {
    // Refresh refused → disconnect so the UI shows the reconnect prompt
    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "moneywise",
      status: "disconnected",
      config: JSON.stringify({}),
    });
    throw new Error("MoneyWise Pro session expired — please reconnect.");
  }
}

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
