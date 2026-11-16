import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { CHANNEL } from "./schema";
import { requireRole } from "./lib/roles";
import { previewOf } from "./lib/agentDecision";

/** More than this many agent messages in a thread within an hour means something is looping. */
const AGENT_MESSAGES_PER_HOUR = 5;

// ── Reading (admin / manager) ────────────────────────────────────────────────

export const listThreads = query({
  args: {
    status: v.optional(v.union(v.literal("open"), v.literal("needs_human"), v.literal("resolved"))),
    channel: v.optional(CHANNEL),
    agentId: v.optional(v.id("agents")),
    label: v.optional(v.string()),
    /** Only conversations with an unsent agent draft waiting. */
    hasDraft: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    const rows = args.status
      ? await ctx.db
          .query("inboxThreads")
          .withIndex("by_orgId_status", (q) => q.eq("orgId", profile.orgId).eq("status", args.status!))
          .order("desc")
          .take(200)
      : await ctx.db
          .query("inboxThreads")
          .withIndex("by_orgId_lastMessageAt", (q) => q.eq("orgId", profile.orgId))
          .order("desc")
          .take(200);

    const filtered = rows.filter(
      (t) =>
        (!args.channel || t.channel === args.channel) &&
        (!args.agentId || t.agentId === args.agentId) &&
        (!args.label || t.labels.includes(args.label)),
    );

    const out = [];
    for (const t of filtered) {
      const latest = await ctx.db
        .query("inboxMessages")
        .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", t._id))
        .order("desc")
        .take(5);
      const hasDraft = latest.some((m) => m.status === "draft");
      if (args.hasDraft && !hasDraft) continue;
      out.push({ ...t, hasDraft });
    }
    return out;
  },
});

export const getThread = query({
  args: { threadId: v.id("inboxThreads") },
  handler: async (ctx, { threadId }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.orgId !== profile.orgId) return null;
    const messages = await ctx.db
      .query("inboxMessages")
      .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", threadId))
      .order("asc")
      .take(200);
    const runs = await ctx.db
      .query("agentRuns")
      .withIndex("by_threadId", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(10);
    return { thread, messages, runs };
  },
});

export const listAccounts = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    const rows = await ctx.db
      .query("channelAccounts")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    // config holds access tokens, which never leave the server.
    return rows.map((row) => {
      let provider: "meta" | "composio" = "meta";
      try {
        if (JSON.parse(row.config ?? "{}").provider === "composio") provider = "composio";
      } catch {}
      return { ...row, config: undefined, provider };
    });
  },
});

// ── Working a conversation (admin / manager) ─────────────────────────────────

async function ownThread(ctx: { db: { get: (id: any) => Promise<any> } }, threadId: Id<"inboxThreads">, orgId: string) {
  const thread = (await ctx.db.get(threadId)) as Doc<"inboxThreads"> | null;
  if (!thread || thread.orgId !== orgId) throw new Error("Conversation not found.");
  return thread;
}

export const markRead = mutation({
  args: { threadId: v.id("inboxThreads") },
  handler: async (ctx, { threadId }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    const t = await ownThread(ctx, threadId, profile.orgId);
    if (t.unreadCount > 0) await ctx.db.patch(threadId, { unreadCount: 0 });
  },
});

export const setStatus = mutation({
  args: { threadId: v.id("inboxThreads"), status: v.union(v.literal("open"), v.literal("needs_human"), v.literal("resolved")) },
  handler: async (ctx, { threadId, status }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    await ownThread(ctx, threadId, profile.orgId);
    await ctx.db.patch(threadId, { status });
  },
});

export const assignAgent = mutation({
  args: { threadId: v.id("inboxThreads"), agentId: v.optional(v.id("agents")) },
  handler: async (ctx, { threadId, agentId }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    await ownThread(ctx, threadId, profile.orgId);
    if (agentId) {
      const a = await ctx.db.get(agentId);
      if (!a || a.orgId !== profile.orgId) throw new Error("Agent not found.");
    }
    await ctx.db.patch(threadId, { agentId });
  },
});

export const setLabels = mutation({
  args: { threadId: v.id("inboxThreads"), labels: v.array(v.string()) },
  handler: async (ctx, { threadId, labels }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    await ownThread(ctx, threadId, profile.orgId);
    const clean = [...new Set(labels.map((l) => l.trim().toLowerCase()).filter(Boolean))].slice(0, 8);
    await ctx.db.patch(threadId, { labels: clean });
  },
});

/** A person writes (or edits an agent draft into) a reply and sends it. */
export const sendReply = mutation({
  args: {
    threadId: v.id("inboxThreads"),
    body: v.string(),
    /** Set when approving an agent's draft: that draft is replaced by the final text. */
    draftId: v.optional(v.id("inboxMessages")),
  },
  handler: async (ctx, { threadId, body, draftId }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    const thread = await ownThread(ctx, threadId, profile.orgId);
    const text = body.trim();
    if (!text) throw new Error("Write a reply first.");

    let author: "human" | "agent" = "human";
    let agentId: Id<"agents"> | undefined;
    let note: string | undefined;
    if (draftId) {
      const draft = await ctx.db.get(draftId);
      if (!draft || draft.threadId !== threadId || draft.status !== "draft") throw new Error("That draft is no longer available.");
      // An approved agent draft is still the agent's message; an edited one is the person's.
      if (draft.body.trim() === text) {
        author = "agent";
        agentId = draft.agentId;
      }
      note = draft.agentNote;
      await ctx.db.patch(draftId, { status: "discarded" });
    }

    const id = await ctx.db.insert("inboxMessages", {
      orgId: thread.orgId,
      threadId,
      direction: "out",
      author,
      agentId,
      body: text,
      status: "sending",
      agentNote: note,
      createdAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.inboxChannels.sendMessage, { messageId: id });
    return id;
  },
});

export const discardDraft = mutation({
  args: { messageId: v.id("inboxMessages") },
  handler: async (ctx, { messageId }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    const m = await ctx.db.get(messageId);
    if (!m || m.orgId !== profile.orgId || m.status !== "draft") return;
    await ctx.db.patch(messageId, { status: "discarded" });
  },
});

/** Ask the owning agent to look at the conversation again (e.g. after editing its instructions). */
export const rerunAgent = mutation({
  args: { threadId: v.id("inboxThreads") },
  handler: async (ctx, { threadId }) => {
    const profile = await requireRole(ctx, ["admin", "manager"]);
    await ownThread(ctx, threadId, profile.orgId);
    await ctx.db.patch(threadId, { handledUpTo: undefined, status: "open" });
    await ctx.scheduler.runAfter(0, internal.agentRunner.handleThread, { threadId });
  },
});

// ── Ingest (called by webhooks and sync jobs) ────────────────────────────────

export const ingestMessage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    accountId: v.id("channelAccounts"),
    channel: CHANNEL,
    externalThreadId: v.string(),
    externalMessageId: v.string(),
    contactName: v.string(),
    contactHandle: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    receivedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const body = args.body.trim();
    if (!body) return { created: false };

    const thread = await ctx.db
      .query("inboxThreads")
      .withIndex("by_account_externalThread", (q) => q.eq("accountId", args.accountId).eq("externalThreadId", args.externalThreadId))
      .unique();

    if (thread) {
      const dup = await ctx.db
        .query("inboxMessages")
        .withIndex("by_thread_externalMessageId", (q) => q.eq("threadId", thread!._id).eq("externalMessageId", args.externalMessageId))
        .first();
      if (dup) return { created: false };
    }

    const lastMessageAt = Math.max(args.receivedAt, thread?.lastMessageAt ?? 0);
    let threadId: Id<"inboxThreads">;
    if (thread) {
      threadId = thread._id;
      await ctx.db.patch(threadId, {
        lastMessageAt,
        lastMessagePreview: previewOf(body),
        lastDirection: "in",
        unreadCount: thread.unreadCount + 1,
        // A new message re-opens a closed conversation.
        status: thread.status === "resolved" ? "open" : thread.status,
        contactName: args.contactName || thread.contactName,
        subject: thread.subject ?? args.subject,
      });
    } else {
      threadId = await ctx.db.insert("inboxThreads", {
        orgId: args.orgId,
        accountId: args.accountId,
        channel: args.channel,
        externalThreadId: args.externalThreadId,
        subject: args.subject,
        contactName: args.contactName || args.contactHandle,
        contactHandle: args.contactHandle,
        lastMessageAt,
        lastMessagePreview: previewOf(body),
        lastDirection: "in",
        unreadCount: 1,
        status: "open",
        labels: [],
      });
    }

    await ctx.db.insert("inboxMessages", {
      orgId: args.orgId,
      threadId,
      direction: "in",
      author: "contact",
      body,
      externalMessageId: args.externalMessageId,
      status: "received",
      createdAt: args.receivedAt,
    });

    await ctx.scheduler.runAfter(0, internal.agentRunner.handleThread, { threadId });
    return { created: true };
  },
});

/** Messages sent from outside Kaizen (e.g. in the Gmail app) so the thread stays complete. */
export const ingestOutbound = internalMutation({
  args: {
    accountId: v.id("channelAccounts"),
    externalThreadId: v.string(),
    externalMessageId: v.string(),
    body: v.string(),
    sentAt: v.number(),
  },
  handler: async (ctx, args) => {
    // Only threads we already know about; an outbound-only thread is not an inbox conversation.
    const thread = await ctx.db
      .query("inboxThreads")
      .withIndex("by_account_externalThread", (q) => q.eq("accountId", args.accountId).eq("externalThreadId", args.externalThreadId))
      .unique();
    if (!thread || !args.body.trim()) return;
    const dup = await ctx.db
      .query("inboxMessages")
      .withIndex("by_thread_externalMessageId", (q) => q.eq("threadId", thread._id).eq("externalMessageId", args.externalMessageId))
      .first();
    if (dup) return;
    await ctx.db.insert("inboxMessages", {
      orgId: thread.orgId,
      threadId: thread._id,
      direction: "out",
      author: "human",
      body: args.body.trim(),
      externalMessageId: args.externalMessageId,
      status: "sent",
      createdAt: args.sentAt,
    });
    if (args.sentAt >= thread.lastMessageAt) {
      await ctx.db.patch(thread._id, { lastMessageAt: args.sentAt, lastMessagePreview: previewOf(args.body), lastDirection: "out" });
    }
  },
});

// ── Used by the agent runner and the senders ─────────────────────────────────

/**
 * Takes the conversation for one agent run. Returns null when there is nothing
 * new for an agent to answer, so double triggers never produce two replies.
 */
export const claimForAgent = internalMutation({
  args: { threadId: v.id("inboxThreads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.status === "resolved") return null;

    const messages = await ctx.db
      .query("inboxMessages")
      .withIndex("by_threadId_createdAt", (q) => q.eq("threadId", threadId))
      .order("desc")
      .take(30);
    const latestIn = messages.find((m) => m.direction === "in");
    if (!latestIn) return null;
    if (thread.handledUpTo !== undefined && thread.handledUpTo >= latestIn.createdAt) return null;
    // A person already answered after this message; nothing for an agent to do.
    if (messages.some((m) => m.direction === "out" && m.author === "human" && m.status === "sent" && m.createdAt > latestIn.createdAt)) {
      await ctx.db.patch(threadId, { handledUpTo: latestIn.createdAt });
      return null;
    }

    const hourAgo = Date.now() - 3_600_000;
    const recentAgentSends = messages.filter((m) => m.author === "agent" && m.direction === "out" && m.createdAt > hourAgo).length;
    await ctx.db.patch(threadId, { handledUpTo: latestIn.createdAt });
    if (recentAgentSends >= AGENT_MESSAGES_PER_HOUR) {
      await ctx.db.patch(threadId, { status: "needs_human" });
      return null;
    }

    const org = await ctx.db.get(thread.orgId);
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", thread.orgId))
      .collect();
    return {
      thread,
      orgName: org?.name ?? "the organisation",
      agents,
      // Oldest first, only what the model needs.
      messages: messages.filter((m) => m.status !== "discarded").reverse(),
    };
  },
});

/** Read-only look at who would handle a conversation, so nothing is claimed when no agent covers it. */
export const peekForAgent = internalQuery({
  args: { threadId: v.id("inboxThreads") },
  handler: async (ctx, { threadId }) => {
    const thread = await ctx.db.get(threadId);
    if (!thread || thread.status === "resolved") return null;
    const agents = await ctx.db
      .query("agents")
      .withIndex("by_orgId", (q) => q.eq("orgId", thread.orgId))
      .collect();
    return { thread, agents };
  },
});

export const getForSend = internalQuery({
  args: { messageId: v.id("inboxMessages") },
  handler: async (ctx, { messageId }) => {
    const message = await ctx.db.get(messageId);
    if (!message) return null;
    const thread = await ctx.db.get(message.threadId);
    if (!thread) return null;
    const account = await ctx.db.get(thread.accountId);
    if (!account) return null;
    // The most recent provider message id in the thread, for threading replies.
    return { message, thread, account };
  },
});

export const recordDecision = internalMutation({
  args: {
    threadId: v.id("inboxThreads"),
    agentId: v.id("agents"),
    model: v.string(),
    action: v.union(v.literal("reply"), v.literal("escalate"), v.literal("ignore"), v.literal("resolve"), v.literal("error")),
    reason: v.string(),
    labels: v.array(v.string()),
    reply: v.string(),
    /** Send the reply now (auto mode) rather than leaving it as a draft. */
    sendNow: v.boolean(),
    /** The agent that takes the conversation next when this one escalates. */
    escalateToAgentId: v.optional(v.id("agents")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread) return;
    const now = Date.now();
    await ctx.db.insert("agentRuns", {
      orgId: thread.orgId,
      threadId: args.threadId,
      agentId: args.agentId,
      decision: args.action,
      model: args.model,
      error: args.error,
      createdAt: now,
    });

    const labels = [...new Set([...thread.labels, ...args.labels])].slice(0, 8);
    const patch: Partial<Doc<"inboxThreads">> = { agentId: args.agentId, labels };

    if (args.action === "reply") {
      const id = await ctx.db.insert("inboxMessages", {
        orgId: thread.orgId,
        threadId: args.threadId,
        direction: "out",
        author: "agent",
        agentId: args.agentId,
        body: args.reply,
        status: args.sendNow ? "sending" : "draft",
        agentNote: args.reason,
        createdAt: now,
      });
      if (args.sendNow) await ctx.scheduler.runAfter(0, internal.inboxChannels.sendMessage, { messageId: id });
    } else if (args.action === "escalate") {
      if (args.escalateToAgentId) {
        // Handed to another agent (usually a supervisor): leave a note and run it.
        patch.agentId = args.escalateToAgentId;
        patch.handledUpTo = undefined;
        await ctx.db.insert("inboxMessages", {
          orgId: thread.orgId,
          threadId: args.threadId,
          direction: "out",
          author: "agent",
          agentId: args.agentId,
          body: `Escalated: ${args.reason || "needs review"}`,
          status: "discarded",
          agentNote: args.reason,
          createdAt: now,
        });
        await ctx.scheduler.runAfter(0, internal.agentRunner.handleThread, { threadId: args.threadId });
      } else {
        patch.status = "needs_human";
      }
    } else if (args.action === "resolve") {
      patch.status = "resolved";
    } else if (args.action === "error") {
      patch.status = "needs_human";
    }
    await ctx.db.patch(args.threadId, patch);
  },
});

export const markMessageResult = internalMutation({
  args: {
    messageId: v.id("inboxMessages"),
    status: v.union(v.literal("sent"), v.literal("failed")),
    externalMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (!m) return;
    await ctx.db.patch(args.messageId, {
      status: args.status,
      externalMessageId: args.externalMessageId ?? m.externalMessageId,
      error: args.error,
    });
    if (args.status === "sent") {
      const t = await ctx.db.get(m.threadId);
      if (t) {
        await ctx.db.patch(m.threadId, {
          lastMessageAt: Date.now(),
          lastMessagePreview: previewOf(m.body),
          lastDirection: "out",
          // Someone has now answered.
          status: t.status === "needs_human" ? "open" : t.status,
        });
      }
    } else {
      await ctx.db.patch(m.threadId, { status: "needs_human" });
    }
  },
});
