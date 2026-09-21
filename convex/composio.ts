"use node";

import { v } from "convex/values";
import { Composio } from "@composio/core";
import { action } from "./_generated/server";
import { api } from "./_generated/api";

function getClient() {
  return new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? "" });
}

/** Returns connected Composio accounts for this org's API key. */
export const listConnectedApps = action({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const composio = getClient();
    const result = await composio.connectedAccounts.list({ userIds: [args.orgId] });

    return result.items.map((item) => ({
      appName: item.toolkit.slug.toLowerCase(),
      status: item.status.toLowerCase(),
      id: item.id,
    }));
  },
});

/** Initiates a Composio connection for an app and returns the redirect URL. */
export const getAppConnectUrl = action({
  args: {
    orgId: v.id("organizations"),
    appName: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.orgId !== args.orgId || profile.role !== "admin") {
      throw new Error("Unauthorized");
    }

    const composio = getClient();

    // Only reuse a Composio-managed auth config — custom configs may have
    // been created with placeholder credentials and will fail.
    const existingConfigs = await composio.authConfigs.list({ toolkit: args.appName });
    const managedConfig = existingConfigs.items.find((c) => c.isComposioManaged);
    const authConfigId =
      managedConfig?.id ?? (await composio.authConfigs.create(args.appName)).id;

    const connectionRequest = await composio.connectedAccounts.link(args.orgId, authConfigId, {
      callbackUrl: args.redirectUri,
      allowMultiple: true,
    });

    return { redirectUrl: connectionRequest.redirectUrl ?? null };
  },
});
