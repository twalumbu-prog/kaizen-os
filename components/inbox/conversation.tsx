"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Bot, CheckCircle2, RotateCw, Send, TriangleAlert, User } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { SELECT_CLASS, agentColor, channelMeta } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

const errText = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^.*Error:\s*/, "") : fallback);

function DraftCard({ message, thread, agent }: { message: Doc<"inboxMessages">; thread: Doc<"inboxThreads">; agent?: Doc<"agents"> }) {
  const send = useMutation(api.inbox.sendReply);
  const discard = useMutation(api.inbox.discardDraft);
  const [text, setText] = useState(message.body);
  const [busy, setBusy] = useState(false);

  return (
    <div className="ml-auto w-full max-w-[85%] rounded-xl border border-dashed border-violet-400/60 bg-violet-500/5 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-violet-700 dark:text-violet-300">
        <Bot className="size-3.5" /> Draft from {agent?.name ?? "an agent"} — not sent yet
      </p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-24 bg-background" />
      {message.agentNote && <p className="mt-2 text-xs text-muted-foreground">Why: {message.agentNote}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => discard({ messageId: message._id }).catch((e) => toast.error(errText(e, "Could not discard")))}
        >
          Discard
        </Button>
        <Button
          size="sm"
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await send({ threadId: thread._id, body: text, draftId: message._id });
            } catch (e) {
              toast.error(errText(e, "Could not send"));
              setBusy(false);
            }
          }}
        >
          <Send /> {text.trim() === message.body.trim() ? "Approve & send" : "Send edited"}
        </Button>
      </div>
    </div>
  );
}

export function Conversation({ threadId, agents }: { threadId: Id<"inboxThreads">; agents: Doc<"agents">[] }) {
  const data = useQuery(api.inbox.getThread, { threadId });
  const markRead = useMutation(api.inbox.markRead);
  const setStatus = useMutation(api.inbox.setStatus);
  const assign = useMutation(api.inbox.assignAgent);
  const rerun = useMutation(api.inbox.rerunAgent);
  const send = useMutation(api.inbox.sendReply);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const unread = data?.thread.unreadCount ?? 0;
  useEffect(() => {
    if (unread > 0) markRead({ threadId }).catch(() => {});
  }, [unread, threadId, markRead]);

  const count = data?.messages.length ?? 0;
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [count, threadId]);

  if (data === undefined) return <Skeleton className="h-full min-h-64 w-full" />;
  if (data === null) return <p className="p-6 text-sm text-muted-foreground">Conversation not found.</p>;

  const { thread, messages, runs } = data;
  const agentById = new Map(agents.map((a) => [a._id, a]));
  const ch = channelMeta(thread.channel);
  const owner = thread.agentId ? agentById.get(thread.agentId) : undefined;
  const lastRun = runs[0];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold">{thread.contactName}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-xs", ch.badge)}>{ch.label}</span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {thread.subject ? `${thread.subject} · ` : ""}
            {thread.contactHandle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Assigned agent"
            className={cn(SELECT_CLASS, "w-auto")}
            value={thread.agentId ?? ""}
            onChange={(e) =>
              assign({ threadId, agentId: e.target.value ? (e.target.value as Id<"agents">) : undefined }).catch((err) =>
                toast.error(errText(err, "Could not assign")),
              )
            }
          >
            <option value="">No agent</option>
            {agents.map((a) => (
              <option key={a._id} value={a._id}>
                {a.name} · {a.title}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => rerun({ threadId }).then(() => toast.success("Asked the agent to look again"))}>
            <RotateCw /> Re-run agent
          </Button>
          {thread.status === "resolved" ? (
            <Button variant="outline" size="sm" onClick={() => setStatus({ threadId, status: "open" })}>
              Reopen
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setStatus({ threadId, status: "resolved" })}>
              <CheckCircle2 /> Resolve
            </Button>
          )}
        </div>
      </header>

      {thread.status === "needs_human" && (
        <div className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-2 text-sm text-amber-800 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            {lastRun?.error ?? (lastRun ? `${agentById.get(lastRun.agentId)?.name ?? "An agent"} handed this to a person.` : "This needs a person.")}
          </span>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {messages
          .filter((m) => m.status !== "discarded")
          .map((m) => {
            if (m.status === "draft") {
              return <DraftCard key={m._id} message={m} thread={thread} agent={m.agentId ? agentById.get(m.agentId) : undefined} />;
            }
            const mine = m.direction === "out";
            const a = m.agentId ? agentById.get(m.agentId) : undefined;
            return (
              <div key={m._id} className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm",
                    mine ? "bg-primary text-primary-foreground" : "bg-muted",
                    m.status === "failed" && "ring-2 ring-destructive",
                  )}
                >
                  {m.body}
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {m.author === "agent" && (
                    <span className={cn("inline-flex items-center gap-1 rounded-full px-1.5 py-0.5", agentColor(a?.color ?? "slate").chip)}>
                      <Bot className="size-3" /> {a?.name ?? "Agent"}
                    </span>
                  )}
                  {m.author === "human" && (
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3" /> Team
                    </span>
                  )}
                  {m.status === "sending" && "Sending…"}
                  {m.status === "failed" && <span className="text-destructive">Not sent: {m.error}</span>}
                  {m.status !== "sending" && m.status !== "failed" && new Date(m.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                </p>
              </div>
            );
          })}
        <div ref={bottom} />
      </div>

      <footer className="border-t p-3">
        <div className="flex items-end gap-2">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={owner ? `Reply yourself (${owner.name} is on this conversation)…` : "Write a reply…"}
            className="max-h-40 min-h-10"
          />
          <Button
            disabled={sending || !reply.trim()}
            onClick={async () => {
              setSending(true);
              try {
                await send({ threadId, body: reply });
                setReply("");
              } catch (e) {
                toast.error(errText(e, "Could not send"));
              } finally {
                setSending(false);
              }
            }}
          >
            <Send /> Send
          </Button>
        </div>
      </footer>
    </div>
  );
}
