"use node";

import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

const SCHOOL_ID = "40658991-1722-4b5b-9e1b-5c31aa005780";
const BASE_URL = `https://dashboard.master-fees.com/api/v1/school/${SCHOOL_ID}/data`;

function mfHeaders(publicKey: string): Record<string, string> {
  return {
    "X-MF-Public-Key": publicKey,
    "Content-Type": "application/json",
  };
}

async function mfFetch(publicKey: string, path: string): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, { headers: mfHeaders(publicKey) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Master Fees API error ${res.status}: ${body}`);
  }
  return res.json();
}

async function getPublicKey(ctx: ActionCtx): Promise<string> {
  const profile = await ctx.runQuery(api.profiles.getMe, {});
  if (!profile) throw new Error("Not authenticated");

  const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
    orgId: profile.orgId,
    provider: "masterfees",
  });

  if (!integration || integration.status !== "active" || !integration.config) {
    throw new Error("Master Fees integration not connected");
  }

  const config = JSON.parse(integration.config) as { publicKey?: string };
  if (!config.publicKey) throw new Error("Master Fees public key not configured");
  return config.publicKey;
}

export const connect = action({
  args: { publicKey: v.string() },
  handler: async (ctx, { publicKey }) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    // Validate the key by fetching fee categories (lightweight endpoint)
    const res = await fetch(`${BASE_URL}/fee-categories`, {
      headers: mfHeaders(publicKey),
    });

    if (res.status === 401) throw new Error("Invalid API key — request was rejected by Master Fees.");
    if (res.status === 403) throw new Error("Access is blocked — the Master Fees endpoint switch may be off.");
    if (!res.ok) throw new Error(`Master Fees returned ${res.status}. Check the key and try again.`);

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "masterfees",
      status: "active",
      config: JSON.stringify({ publicKey }),
    });
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
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

export const getStudents = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/students");
  },
});

export const getInvoices = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/invoices");
  },
});

export const getTransactions = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/transactions");
  },
});

export const getLedger = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/ledger");
  },
});

export const getPaymentsSummary = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/summary/payments");
  },
});

export const getOutstandingBalances = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/summary/balances");
  },
});

export const getFeeCategories = action({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const key = await getPublicKey(ctx);
    return mfFetch(key, "/fee-categories");
  },
});
