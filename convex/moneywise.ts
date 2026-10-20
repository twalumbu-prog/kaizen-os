"use node";

import { v } from "convex/values";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const MWP_BASE_URL = "https://moneywise.blueopus.cloud/api/v1";
const MWP_AUTH_URL = "https://moneywise.blueopus.cloud/oauth/authorize";

function mwpHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function mwpFetch(
  apiKey: string,
  path: string,
  options?: RequestInit
): Promise<unknown> {
  const res = await fetch(`${MWP_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...mwpHeaders(apiKey),
      ...((options?.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`MoneyWise Pro API error ${res.status}: ${body}`);
  }
  return res.json();
}

type MwpConfig = { apiKey: string; orgName: string };

async function getMwpConfig(ctx: ActionCtx): Promise<MwpConfig> {
  const profile = await ctx.runQuery(api.profiles.getMe, {});
  if (!profile) throw new Error("Not authenticated");

  const integration = await ctx.runQuery(
    internal.integrations.getInternalIntegration,
    { orgId: profile.orgId, provider: "moneywise" }
  );

  if (!integration || integration.status !== "active" || !integration.config) {
    throw new Error("MoneyWise Pro integration not connected");
  }

  const config = JSON.parse(integration.config) as Partial<MwpConfig>;
  if (!config.apiKey) {
    throw new Error("MoneyWise Pro is missing API key — please reconnect.");
  }

  return { apiKey: config.apiKey, orgName: config.orgName ?? "" };
}

// ── OAuth-style connect flow ──────────────────────────────────────────────────

export const getAuthUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, { redirectUri }): Promise<string> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const state = await ctx.runMutation(internal.lib.oauthState.createState, {
      orgId: profile.orgId,
      provider: "moneywise",
    });

    const url = new URL(MWP_AUTH_URL);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  },
});

type CallbackResult =
  | { success: true; orgId: Id<"organizations"> }
  | { success: false };

export const handleCallback = internalAction({
  args: { apiKey: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<CallbackResult> => {
    let orgId: Id<"organizations">;
    try {
      orgId = await ctx.runMutation(internal.lib.oauthState.consumeState, {
        token: args.state,
        provider: "moneywise",
      });
    } catch (e) {
      console.error("MoneyWise Pro callback: invalid state", e);
      return { success: false };
    }

    const testRes = await fetch(`${MWP_BASE_URL}/organization`, {
      headers: mwpHeaders(args.apiKey),
    });
    if (!testRes.ok) {
      console.error("MoneyWise Pro callback: key validation failed", testRes.status);
      return { success: false };
    }
    const org = (await testRes.json()) as { name?: string };

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId,
      provider: "moneywise",
      status: "active",
      config: JSON.stringify({ apiKey: args.apiKey, orgName: org.name ?? "" }),
    });

    return { success: true, orgId };
  },
});

// ── Manual key entry ──────────────────────────────────────────────────────────

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
      throw new Error(
        `MoneyWise Pro returned ${testRes.status}. Check credentials and try again.`
      );

    const org = (await testRes.json()) as { name?: string };
    const orgName = org.name ?? "";

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "moneywise",
      status: "active",
      config: JSON.stringify({ apiKey, orgName }),
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
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/organization");
  },
});

export const listWallets = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/wallets");
  },
});

export const getBalance = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/balance");
  },
});

export const listTransactions = action({
  args: {
    cursor: v.optional(v.string()),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
  },
  handler: async (ctx, { cursor, from, to }): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    return mwpFetch(apiKey, `/transactions${qs ? `?${qs}` : ""}`);
  },
});

export const listAccounts = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/accounts");
  },
});

export const listRequisitions = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/requisitions");
  },
});

export const getRequisition = action({
  args: { id: v.string() },
  handler: async (ctx, { id }): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, `/requisitions/${id}`);
  },
});

export const listProducts = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/products");
  },
});

export const listPaymentLinks = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/payment-links");
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
    const { apiKey } = await getMwpConfig(ctx);
    return mwpFetch(apiKey, "/payment-links", {
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
