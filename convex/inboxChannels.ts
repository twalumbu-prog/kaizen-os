"use node";

import { v } from "convex/values";
import { Composio } from "@composio/core";
import { action, internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { parseGmailMessage } from "./lib/gmailParse";
import { extractList, inboundMessages, otherParticipant } from "./lib/socialParse";

const GRAPH = "https://graph.facebook.com/v21.0";
/** First sync looks back this far; later syncs look back to the last sync (minus an hour of overlap). */
const FIRST_SYNC_DAYS = 2;
const MAX_EMAILS = 40;

function composioClient() {
  return new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? "" });
}

async function runTool(composio: Composio, userId: string, slug: string, connectedAccountId: string, args: object) {
  const res = await (composio as any).tools.execute(slug, {
    userId,
    connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  if (!res?.successful) throw new Error(`${slug} failed: ${String(res?.error ?? "unknown error").slice(0, 300)}`);
  return res.data;
}

// ── Gmail ────────────────────────────────────────────────────────────────────

/** Links the organisation's Composio-connected Gmail mailbox to the inbox. */
export const connectGmail = action({
  args: {},
  handler: async (ctx): Promise<{ email: string }> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.role !== "admin") throw new Error("Unauthorized");
    const orgId = profile.orgId as string;

    const composio = composioClient();
    const list = await composio.connectedAccounts.list({ userIds: [orgId], toolkitSlugs: ["gmail"], statuses: ["ACTIVE"] });
    const connectedAccountId = list.items?.[0]?.id;
    if (!connectedAccountId) throw new Error("Gmail is not connected yet. Connect it under Integrations first.");

    const data = await runTool(composio, orgId, "GMAIL_GET_PROFILE", connectedAccountId, { user_id: "me" });
    const email = String(data?.emailAddress ?? data?.response_data?.emailAddress ?? "").toLowerCase();
    if (!email) throw new Error("Could not read the Gmail address for this connection.");

    await ctx.runMutation(internal.inboxAccounts.upsert, {
      orgId: profile.orgId as Id<"organizations">,
      channel: "gmail",
      label: email,
      externalId: email,
      config: JSON.stringify({ connectedAccountId }),
    });
    return { email };
  },
});

async function syncGmailAccount(
  ctx: { runMutation: Function },
  composio: Composio,
  account: { _id: Id<"channelAccounts">; orgId: Id<"organizations">; externalId: string; config?: string; lastSyncAt?: number },
) {
  const cfg = JSON.parse(account.config ?? "{}") as { connectedAccountId?: string };
  if (!cfg.connectedAccountId) throw new Error("Gmail connection is missing; reconnect it.");

  const since = account.lastSyncAt ? account.lastSyncAt - 3_600_000 : Date.now() - FIRST_SYNC_DAYS * 86_400_000;
  const data = await runTool(composio, account.orgId as string, "GMAIL_FETCH_EMAILS", cfg.connectedAccountId, {
    user_id: "me",
    query: `after:${Math.floor(since / 1000)} -category:promotions -category:social -category:forums`,
    max_results: MAX_EMAILS,
    include_payload: true,
    verbose: true,
  });

  const raws: Record<string, any>[] = data?.messages ?? data?.response_data?.messages ?? [];
  // Oldest first so threads are built in order.
  const parsed = raws
    .map((r) => parseGmailMessage(r, account.externalId))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => a.at - b.at);

  for (const m of parsed) {
    if (m.outbound) {
      await ctx.runMutation(internal.inbox.ingestOutbound, {
        accountId: account._id,
        externalThreadId: m.threadId,
        externalMessageId: m.id,
        body: m.body,
        sentAt: m.at,
      });
    } else {
      await ctx.runMutation(internal.inbox.ingestMessage, {
        orgId: account.orgId,
        accountId: account._id,
        channel: "gmail",
        externalThreadId: m.threadId,
        externalMessageId: m.id,
        contactName: m.fromName || m.fromEmail,
        contactHandle: m.fromEmail,
        subject: m.subject,
        body: m.body,
        receivedAt: m.at,
      });
    }
  }
}

/** Cron: pull new mail for every connected Gmail mailbox. */
export const syncAllGmail = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.COMPOSIO_API_KEY) return;
    const accounts = await ctx.runQuery(internal.inboxAccounts.listActiveGmail, {});
    const composio = composioClient();
    for (const account of accounts) {
      try {
        await syncGmailAccount(ctx, composio, account);
        await ctx.runMutation(internal.inboxAccounts.markSynced, { accountId: account._id });
      } catch (e) {
        await ctx.runMutation(internal.inboxAccounts.markSynced, {
          accountId: account._id,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        });
      }
    }
  },
});

/** "Sync now" button. */
export const syncNow = action({
  args: {},
  handler: async (ctx) => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || (profile.role !== "admin" && profile.role !== "manager")) throw new Error("Unauthorized");
    await ctx.runAction(internal.inboxChannels.syncAllGmail, {});
    await ctx.runAction(internal.inboxChannels.syncAllComposioSocial, {});
  },
});

// ── Facebook / Instagram / WhatsApp through Composio ────────────────────────

const TOOLKIT = { facebook: "facebook", instagram: "instagram", whatsapp: "whatsapp" } as const;

/** Links a Composio-connected Facebook Page, Instagram account or WhatsApp number to the inbox. */
export const connectComposioChannel = action({
  args: {
    channel: v.union(v.literal("facebook"), v.literal("instagram"), v.literal("whatsapp")),
    /** Facebook Page id (when the user manages several), or the WhatsApp phone number id. */
    externalId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ label: string }> => {
    const profile = await ctx.runQuery(api.profiles.getMe, {});
    if (!profile || profile.role !== "admin") throw new Error("Unauthorized");
    const orgId = profile.orgId as string;

    const composio = composioClient();
    const list = await composio.connectedAccounts.list({ userIds: [orgId], toolkitSlugs: [TOOLKIT[args.channel]], statuses: ["ACTIVE"] });
    const composioAccountId = list.items?.[0]?.id;
    if (!composioAccountId) throw new Error(`${args.channel} is not connected in Composio yet. Connect it under Integrations first.`);

    let externalId = args.externalId?.trim() ?? "";
    let label = externalId;
    if (args.channel === "facebook") {
      const pages = extractList(await runTool(composio, orgId, "FACEBOOK_LIST_MANAGED_PAGES", composioAccountId, {}));
      const page = externalId ? pages.find((p) => String(p.id) === externalId) : pages.length === 1 ? pages[0] : undefined;
      if (!page) {
        throw new Error(
          pages.length === 0
            ? "No Facebook Pages were found for this connection."
            : `Several Pages found; enter one Page ID: ${pages.map((p) => `${p.name} (${p.id})`).join(", ")}`,
        );
      }
      externalId = String(page.id);
      label = String(page.name ?? externalId);
    } else if (args.channel === "instagram") {
      const data = await runTool(composio, orgId, "INSTAGRAM_GET_USER_INFO", composioAccountId, {});
      const info = (data?.response_data ?? data) as Record<string, any>;
      externalId = String(info?.id ?? info?.data?.id ?? externalId);
      label = String(info?.username ?? info?.data?.username ?? externalId);
      if (!externalId) throw new Error("Could not read the Instagram account for this connection.");
    } else if (!externalId) {
      throw new Error("Enter the WhatsApp phone number ID.");
    }

    await ctx.runMutation(internal.inboxAccounts.upsert, {
      orgId: profile.orgId as Id<"organizations">,
      channel: args.channel,
      label,
      externalId,
      config: JSON.stringify({ provider: "composio", composioAccountId }),
    });
    return { label };
  },
});

async function syncComposioSocialAccount(
  ctx: { runMutation: Function },
  composio: Composio,
  account: { _id: Id<"channelAccounts">; orgId: Id<"organizations">; channel: "facebook" | "instagram"; externalId: string; config?: string; lastSyncAt?: number },
) {
  const cfg = JSON.parse(account.config ?? "{}") as { composioAccountId?: string };
  if (!cfg.composioAccountId) throw new Error("Connection is missing; reconnect it.");
  const user = account.orgId as string;
  const since = account.lastSyncAt ? account.lastSyncAt - 3_600_000 : Date.now() - FIRST_SYNC_DAYS * 86_400_000;

  const convs =
    account.channel === "facebook"
      ? await runTool(composio, user, "FACEBOOK_GET_PAGE_CONVERSATIONS", cfg.composioAccountId, {
          page_id: account.externalId,
          limit: 25,
          fields: "id,updated_time,participants",
        })
      : await runTool(composio, user, "INSTAGRAM_LIST_ALL_CONVERSATIONS", cfg.composioAccountId, {
          ig_user_id: account.externalId,
          platform: "instagram",
          limit: 25,
          fields: "id,updated_time,participants",
        });

  for (const conv of extractList(convs)) {
    const updated = Date.parse(String(conv.updated_time ?? ""));
    if (Number.isFinite(updated) && updated < since) continue;
    const contact = otherParticipant(conv, account.externalId);
    if (!contact || !conv.id) continue;

    const msgs =
      account.channel === "facebook"
        ? await runTool(composio, user, "FACEBOOK_GET_CONVERSATION_MESSAGES", cfg.composioAccountId, {
            page_id: account.externalId,
            conversation_id: String(conv.id),
            limit: 20,
            fields: "id,message,from,created_time",
          })
        : await runTool(composio, user, "INSTAGRAM_LIST_ALL_MESSAGES", cfg.composioAccountId, {
            conversation_id: String(conv.id),
            limit: 20,
            fields: "id,message,from,created_time",
          });

    for (const m of inboundMessages(msgs, account.externalId)) {
      if (m.at < since) continue;
      await ctx.runMutation(internal.inbox.ingestMessage, {
        orgId: account.orgId,
        accountId: account._id,
        channel: account.channel,
        // Same key the webhook uses, so the two routes never create two threads for one person.
        externalThreadId: contact.id,
        externalMessageId: m.id,
        contactName: contact.name || m.fromName,
        contactHandle: contact.id,
        body: m.text,
        receivedAt: m.at,
      });
    }
  }
}

/** Cron: pull new Facebook / Instagram messages for accounts connected through Composio. */
export const syncAllComposioSocial = internalAction({
  args: {},
  handler: async (ctx) => {
    if (!process.env.COMPOSIO_API_KEY) return;
    const accounts = await ctx.runQuery(internal.inboxAccounts.listActiveComposioSocial, {});
    const composio = composioClient();
    for (const account of accounts) {
      try {
        await syncComposioSocialAccount(ctx, composio, account as never);
        await ctx.runMutation(internal.inboxAccounts.markSynced, { accountId: account._id });
      } catch (e) {
        await ctx.runMutation(internal.inboxAccounts.markSynced, {
          accountId: account._id,
          error: (e instanceof Error ? e.message : String(e)).slice(0, 300),
        });
      }
    }
  },
});

// ── Sending ──────────────────────────────────────────────────────────────────

async function metaPost(path: string, token: string, body: object): Promise<string | undefined> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Meta error ${res.status}`);
  return data?.messages?.[0]?.id ?? data?.message_id;
}

/** Delivers an outbound message (agent- or human-written) on the thread's channel. */
export const sendMessage = internalAction({
  args: { messageId: v.id("inboxMessages") },
  handler: async (ctx, { messageId }) => {
    const found = await ctx.runQuery(internal.inbox.getForSend, { messageId });
    // Only a message in "sending" goes out, and only once.
    if (!found || found.message.status !== "sending") return;
    const { message, thread, account } = found;
    const fail = (error: string) =>
      ctx.runMutation(internal.inbox.markMessageResult, { messageId, status: "failed", error: error.slice(0, 300) });

    if (account.status !== "active") return void (await fail("This account is disconnected."));
    const cfg = JSON.parse(account.config ?? "{}") as { provider?: string; composioAccountId?: string; connectedAccountId?: string; accessToken?: string; pageId?: string };
    // No token stored on the account: use the one from the organisation's Meta integration.
    const viaComposio = thread.channel !== "gmail" && cfg.provider === "composio";
    if (thread.channel !== "gmail" && !viaComposio && !cfg.accessToken) {
      const meta = await ctx.runQuery(internal.integrations.getInternalIntegration, { orgId: account.orgId, provider: "meta" });
      if (meta?.status === "active" && meta.config) {
        try {
          cfg.accessToken = (JSON.parse(meta.config) as { accessToken?: string }).accessToken;
        } catch {}
      }
    }

    try {
      let externalId: string | undefined;
      if (thread.channel === "gmail") {
        if (!cfg.connectedAccountId) throw new Error("Gmail connection is missing; reconnect it.");
        const data = await runTool(composioClient(), account.orgId as string, "GMAIL_REPLY_TO_THREAD", cfg.connectedAccountId, {
          user_id: "me",
          thread_id: thread.externalThreadId,
          recipient_email: thread.contactHandle,
          message_body: message.body,
          is_html: false,
        });
        externalId = data?.id ?? data?.response_data?.id;
      } else if (viaComposio) {
        if (!cfg.composioAccountId) throw new Error("Composio connection is missing; reconnect it.");
        const composio = composioClient();
        const user = account.orgId as string;
        let data: Record<string, any> | undefined;
        if (thread.channel === "facebook") {
          data = await runTool(composio, user, "FACEBOOK_SEND_MESSAGE", cfg.composioAccountId, {
            page_id: account.externalId,
            recipient_id: thread.contactHandle,
            message_text: message.body,
            messaging_type: "RESPONSE",
          });
        } else if (thread.channel === "instagram") {
          data = await runTool(composio, user, "INSTAGRAM_SEND_TEXT_MESSAGE", cfg.composioAccountId, {
            ig_user_id: account.externalId,
            recipient_id: thread.contactHandle,
            text: message.body,
          });
        } else {
          data = await runTool(composio, user, "WHATSAPP_SEND_MESSAGE", cfg.composioAccountId, {
            phone_number_id: account.externalId,
            to_number: thread.contactHandle,
            text: message.body,
          });
        }
        externalId = String(data?.message_id ?? data?.messages?.[0]?.id ?? data?.response_data?.message_id ?? "") || undefined;
      } else if (thread.channel === "whatsapp") {
        if (!cfg.accessToken) throw new Error("WhatsApp access token is missing.");
        externalId = await metaPost(`${account.externalId}/messages`, cfg.accessToken, {
          messaging_product: "whatsapp",
          to: thread.contactHandle,
          type: "text",
          text: { body: message.body },
        });
      } else {
        // Facebook Messenger and Instagram DMs both send through the Page.
        if (!cfg.accessToken) throw new Error("Access token is missing.");
        const pageId = cfg.pageId || account.externalId;
        externalId = await metaPost(`${pageId}/messages`, cfg.accessToken, {
          recipient: { id: thread.contactHandle },
          messaging_type: "RESPONSE",
          message: { text: message.body },
        });
      }
      await ctx.runMutation(internal.inbox.markMessageResult, { messageId, status: "sent", externalMessageId: externalId });
    } catch (e) {
      await fail(e instanceof Error ? e.message : String(e));
    }
  },
});
