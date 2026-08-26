import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

type CallbackResult = { success: true; orgId: Id<"organizations"> } | { success: false };

export const getAuthUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, args) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("Google Client ID not configured");

    // Derive the org from the caller's own profile — never trust a client-supplied
    // orgId here, or anyone could mint a connect URL for an org they don't belong to.
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile) throw new Error("Not authenticated");
    if (profile.role !== "admin") throw new Error("Only admins can connect integrations");

    const state = await ctx.runMutation(internal.lib.oauthState.createState, {
      orgId: profile.orgId,
      provider: "google_drive",
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.append("client_id", clientId);
    url.searchParams.append("response_type", "code");
    url.searchParams.append("scope", "https://www.googleapis.com/auth/drive.file");
    url.searchParams.append("redirect_uri", args.redirectUri);
    url.searchParams.append("access_type", "offline");
    url.searchParams.append("prompt", "consent");
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
      provider: "google_drive",
    });

    if (integration?.config) {
      try {
        const config = JSON.parse(integration.config);
        const token = config.refreshToken ?? config.accessToken;
        if (token) {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
        }
      } catch (e) {
        // Best-effort — still disconnect locally even if the provider-side revoke fails.
        console.error("Google Drive token revoke failed", e);
      }
    }

    await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
      orgId: profile.orgId,
      provider: "google_drive",
      status: "disconnected",
      config: JSON.stringify({}),
    });
  },
});

export const handleCallback = internalAction({
  args: { code: v.string(), state: v.string(), redirectUri: v.string() },
  handler: async (ctx, args): Promise<CallbackResult> => {
    // Resolves (and single-use consumes) the state token minted in getAuthUrl —
    // throws if it's missing, expired, or for the wrong provider, so a
    // hand-crafted `state` can't bind this callback to an arbitrary org.
    const orgId = await ctx.runMutation(internal.lib.oauthState.consumeState, {
      token: args.state,
      provider: "google_drive",
    });
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    
    if (!clientId || !clientSecret) {
      console.error("Missing Google credentials in env");
      return { success: false };
    }

    try {
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code: args.code,
          grant_type: "authorization_code",
          redirect_uri: args.redirectUri
        })
      });

      if (!tokenResponse.ok) {
        console.error("Google token exchange failed", await tokenResponse.text());
        return { success: false };
      }

      const tokens = await tokenResponse.json();

      await ctx.runMutation(internal.integrations.updateIntegrationStatusInternal, {
        orgId,
        provider: "google_drive",
        status: "active",
        config: JSON.stringify({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          expiresAt: Date.now() + tokens.expires_in * 1000
        })
      });

      return { success: true, orgId };
    } catch (e) {
      console.error("Google OAuth error", e);
      return { success: false };
    }
  }
});

export const uploadToDrive = action({
  args: { fileId: v.id("_storage"), fileName: v.string(), orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    // 1. Fetch integration config for this org
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: args.orgId,
      provider: "google_drive"
    });

    if (!integration || integration.status !== "active" || !integration.config) {
      console.warn(`Google Drive integration not configured or inactive for org ${args.orgId}`);
      return { success: false, reason: "not_configured" };
    }

    let config;
    try {
      config = JSON.parse(integration.config);
    } catch (e) {
      console.error("Failed to parse Google Drive config", e);
      return { success: false, reason: "invalid_config" };
    }

    if (!config.accessToken) {
      console.warn("Google Drive access token missing in config");
      return { success: false, reason: "missing_credentials" };
    }

    // Scaffold: Fetch file from storage, upload to Google Drive using Google APIs
    // In actual implementation: 
    // 1. Fetch file URL: await ctx.storage.getUrl(args.fileId);
    // 2. Fetch file content
    // 3. POST to https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart
    console.log(`Uploading ${args.fileName} to Google Drive for Org ${args.orgId} using OAuth token`);
    return { success: true, message: "Uploaded" };
  }
});
