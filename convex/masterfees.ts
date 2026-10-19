"use node";

import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/** Master Fees OAuth authorization endpoint. */
const MF_AUTH_URL = "https://dashboard.master-fees.com/oauth/authorize";

function mfBaseUrl(schoolId: string): string {
  return `https://dashboard.master-fees.com/api/v1/school/${schoolId}/data`;
}

function mfHeaders(publicKey: string): Record<string, string> {
  return {
    "X-MF-Public-Key": publicKey,
    "Content-Type": "application/json",
  };
}

async function mfFetch(publicKey: string, schoolId: string, path: string): Promise<unknown> {
  const url = `${mfBaseUrl(schoolId)}${path}`;
  const res = await fetch(url, { headers: mfHeaders(publicKey) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Master Fees API error ${res.status}: ${body}`);
  }
  return res.json();
}

type MfConfig = {
  publicKey: string;
  schoolId: string;
  schoolName: string;
};

async function getMfConfig(ctx: ActionCtx): Promise<MfConfig> {
  const profile = await ctx.runQuery(api.profiles.getMe, {});
  if (!profile) throw new Error("Not authenticated");

  const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
    orgId: profile.orgId,
    provider: "masterfees",
  });

  if (!integration || integration.status !== "active" || !integration.config) {
    throw new Error("Master Fees integration not connected");
  }

  const config = JSON.parse(integration.config) as Partial<MfConfig>;
  if (!config.publicKey || !config.schoolId) {
    throw new Error("Master Fees integration is missing credentials — please reconnect.");
  }

  return {
    publicKey: config.publicKey,
    schoolId: config.schoolId,
    schoolName: config.schoolName ?? "Unknown School",
  };
}

// ── OAuth-style connect flow ─────────────────────────────────────────────────

/**
 * Builds the redirect URL to send the admin to the Master Fees authorization
 * page. Master Fees will ask them to confirm the school, then redirect back
 * to /api/masterfees/callback with school_id, public_key, school_name, and
 * the state token we issued here.
 */
export const getAuthUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, { redirectUri }): Promise<string> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const state = await ctx.runMutation(internal.lib.oauthState.createState, {
      orgId: profile.orgId,
      provider: "masterfees",
    });

    const url = new URL(MF_AUTH_URL);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return url.toString();
  },
});

type CallbackResult = { success: true; orgId: Id<"organizations"> } | { success: false };

/**
 * Handles the callback from Master Fees after the admin authorizes.
 * Expects: school_id, public_key, school_name, state.
 */
export const handleCallback = internalAction({
  args: {
    schoolId: v.string(),
    publicKey: v.string(),
    schoolName: v.string(),
    state: v.string(),
  },
  handler: async (ctx, args): Promise<CallbackResult> => {
    let orgId: Id<"organizations">;
    try {
      orgId = await ctx.runMutation(internal.lib.oauthState.consumeState, {
        token: args.state,
        provider: "masterfees",
      });
    } catch (e) {
      console.error("Master Fees callback: invalid state", e);
      return { success: false };
    }

    // Validate the key actually works before saving it.
    const testRes = await fetch(`${mfBaseUrl(args.schoolId)}/fee-categories`, {
      headers: mfHeaders(args.publicKey),
    });
    if (!testRes.ok) {
      console.error("Master Fees callback: key validation failed", testRes.status);
      return { success: false };
    }

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId,
      provider: "masterfees",
      status: "active",
      config: JSON.stringify({
        publicKey: args.publicKey,
        schoolId: args.schoolId,
        schoolName: args.schoolName,
      }),
    });

    return { success: true, orgId };
  },
});

// ── Manual key entry fallback ────────────────────────────────────────────────

/**
 * Direct connect: admin supplies key + school ID manually (fallback for when
 * the Master Fees OAuth redirect isn't available). Validates live before saving.
 */
export const connect = action({
  args: {
    publicKey: v.string(),
    schoolId: v.string(),
    schoolName: v.optional(v.string()),
  },
  handler: async (ctx, { publicKey, schoolId, schoolName }): Promise<void> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const testRes = await fetch(`${mfBaseUrl(schoolId)}/fee-categories`, {
      headers: mfHeaders(publicKey),
    });
    if (testRes.status === 401) throw new Error("Invalid public key — rejected by Master Fees.");
    if (testRes.status === 403) throw new Error("Access blocked — check the Master Fees endpoint switch.");
    if (!testRes.ok) throw new Error(`Master Fees returned ${testRes.status}. Check credentials and try again.`);

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "masterfees",
      status: "active",
      config: JSON.stringify({
        publicKey,
        schoolId,
        schoolName: schoolName ?? "Twalumbu Education Centre",
      }),
    });
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
      provider: "masterfees",
      status: "disconnected",
      config: JSON.stringify({}),
    });
  },
});

// ── Data endpoints ───────────────────────────────────────────────────────────

export const getStudents = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/students");
  },
});

export const getInvoices = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/invoices");
  },
});

export const getTransactions = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/transactions");
  },
});

export const getLedger = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/ledger");
  },
});

export const getPaymentsSummary = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/summary/payments");
  },
});

export const getOutstandingBalances = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/summary/balances");
  },
});

export const getFeeCategories = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const { publicKey, schoolId } = await getMfConfig(ctx);
    return mfFetch(publicKey, schoolId, "/fee-categories");
  },
});
