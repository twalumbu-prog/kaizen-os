import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({
  path: "/revalidate",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    // Re-runs validation for every submission — an expensive, org-wide admin
    // operation, so it's gated behind a shared secret rather than left open.
    const secret = process.env.ADMIN_TASK_SECRET;
    if (!secret) {
      return new Response("ADMIN_TASK_SECRET not configured", { status: 500 });
    }
    if (request.headers.get("x-admin-secret") !== secret) {
      return new Response("Unauthorized", { status: 401 });
    }
    await ctx.runAction(internal.revalidateAll.run, {});
    return new Response("Revalidation triggered", { status: 200 });
  }),
});

http.route({
  path: "/api/quickbooks/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const realmId = url.searchParams.get("realmId");
    const state = url.searchParams.get("state");

    if (!code || !realmId || !state) {
      return new Response("Missing parameters", { status: 400 });
    }

    const redirectUri = `${url.origin}/api/quickbooks/callback`;
    const result = await ctx.runAction(internal.quickbooks.handleCallback, {
      code,
      realmId,
      state,
      redirectUri
    });

    const appUrl = process.env.SITE_URL;
    if (appUrl) {
      const dest = new URL("/admin/integrations/quickbooks", appUrl);
      dest.searchParams.set(result.success ? "connected" : "error", "quickbooks");
      return Response.redirect(dest.toString(), 302);
    }

    // Fallback if SITE_URL isn't configured — still completes the connection,
    // just can't send the browser back into the app automatically.
    if (result.success) {
      return new Response("QuickBooks connected successfully! You can close this window.", { status: 200 });
    } else {
      return new Response("Failed to connect to QuickBooks.", { status: 500 });
    }
  }),
});

http.route({
  path: "/api/drive/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return new Response("Missing parameters", { status: 400 });
    }

    const redirectUri = `${url.origin}/api/drive/callback`;
    const result = await ctx.runAction(internal.drive.handleCallback, {
      code,
      state,
      redirectUri
    });

    const appUrl = process.env.SITE_URL;
    if (appUrl) {
      const dest = new URL("/admin/integrations/drive", appUrl);
      dest.searchParams.set(result.success ? "connected" : "error", "google_drive");
      return Response.redirect(dest.toString(), 302);
    }

    // Fallback if SITE_URL isn't configured — still completes the connection,
    // just can't send the browser back into the app automatically.
    if (result.success) {
      return new Response("Google Drive connected successfully! You can close this window.", { status: 200 });
    } else {
      return new Response("Failed to connect to Google Drive.", { status: 500 });
    }
  }),
});

export default http;

