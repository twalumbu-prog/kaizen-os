"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Bot, Inbox as InboxIcon, Plug } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { Conversation } from "@/components/inbox/conversation";
import { CHANNELS, SELECT_CLASS, agentColor, channelMeta, timeAgo, type Channel } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

type Status = "all" | "needs_human" | "open" | "resolved";

const STATUS_TABS: { id: Status; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_human", label: "Needs you" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
];

export function InboxView() {
  const [status, setStatus] = useState<Status>("all");
  const [channel, setChannel] = useState<Channel | "">("");
  const [agentId, setAgentId] = useState("");
  const [label, setLabel] = useState("");
  const [draftsOnly, setDraftsOnly] = useState(false);
  const [selected, setSelected] = useState<Id<"inboxThreads"> | null>(null);

  const agents = useQuery(api.agents.list);
  const accounts = useQuery(api.inbox.listAccounts);
  const threads = useQuery(api.inbox.listThreads, {
    status: status === "all" ? undefined : status,
    channel: channel || undefined,
    agentId: agentId ? (agentId as Id<"agents">) : undefined,
    label: label || undefined,
    hasDraft: draftsOnly || undefined,
  });
  // Labels offered in the filter come from the unfiltered-by-label list currently on screen.
  const allLabels = useMemo(() => [...new Set((threads ?? []).flatMap((t) => t.labels))].sort(), [threads]);
  const agentById = useMemo(() => new Map((agents ?? []).map((a) => [a._id, a])), [agents]);

  const noAccounts = accounts !== undefined && accounts.filter((a) => a.status === "active").length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <InboxIcon className="size-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
            <p className="text-sm text-muted-foreground">Every channel in one place, with the agent handling each conversation.</p>
          </div>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/admin/integrations" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 hover:bg-muted">
            <Plug className="size-4" /> Channels
          </Link>
          <Link href="/agents" className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 hover:bg-muted">
            <Bot className="size-4" /> Agents
          </Link>
        </div>
      </div>

      {noAccounts && (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          No channels are connected yet.{" "}
          <Link href="/admin/integrations" className="font-medium text-foreground underline">
            Connect Gmail, WhatsApp, Instagram or Facebook
          </Link>{" "}
          to start receiving messages here.
        </div>
      )}

      <div className="grid min-h-[34rem] gap-4 lg:h-[calc(100vh-17rem)] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border">
          <div className="flex gap-1 border-b p-2">
            {STATUS_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setStatus(t.id)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  status === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 border-b p-2">
            <select aria-label="Channel" className={SELECT_CLASS} value={channel} onChange={(e) => setChannel(e.target.value as Channel | "")}>
              <option value="">All channels</option>
              {CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
            <select aria-label="Agent" className={SELECT_CLASS} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">All agents</option>
              {(agents ?? []).map((a) => (
                <option key={a._id} value={a._id}>
                  {a.name}
                </option>
              ))}
            </select>
            <select aria-label="Label" className={SELECT_CLASS} value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">All labels</option>
              {allLabels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={draftsOnly} onChange={(e) => setDraftsOnly(e.target.checked)} />
              Drafts to approve
            </label>
          </div>

          <ul className="min-h-0 flex-1 overflow-y-auto">
            {threads === undefined ? (
              <li className="p-3">
                <Skeleton className="h-16 w-full" />
              </li>
            ) : threads.length === 0 ? (
              <li className="p-6 text-center text-sm text-muted-foreground">No conversations match.</li>
            ) : (
              threads.map((t) => {
                const ch = channelMeta(t.channel);
                const a = t.agentId ? agentById.get(t.agentId) : undefined;
                return (
                  <li key={t._id}>
                    <button
                      onClick={() => setSelected(t._id)}
                      className={cn(
                        "flex w-full flex-col gap-1 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                        selected === t._id && "bg-muted",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className={cn("truncate text-sm", t.unreadCount > 0 ? "font-semibold" : "font-medium")}>{t.contactName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(t.lastMessageAt)}</span>
                      </div>
                      {t.subject && <span className="truncate text-xs font-medium">{t.subject}</span>}
                      <span className="line-clamp-1 text-xs text-muted-foreground">{t.lastMessagePreview}</span>
                      <div className="flex flex-wrap items-center gap-1">
                        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", ch.badge)}>{ch.label}</span>
                        {a && (
                          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px]", agentColor(a.color).chip)}>
                            {a.name} · {a.title}
                          </span>
                        )}
                        {t.hasDraft && <span className="rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-700 dark:text-violet-300">Draft ready</span>}
                        {t.status === "needs_human" && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">Needs you</span>}
                        {t.status === "resolved" && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Resolved</span>}
                        {t.labels.map((l) => (
                          <span key={l} className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {l}
                          </span>
                        ))}
                        {t.unreadCount > 0 && <span className="ml-auto size-2 rounded-full bg-primary" aria-label="Unread" />}
                      </div>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </section>

        <section className="min-h-0 overflow-hidden rounded-xl border">
          {selected ? (
            <Conversation threadId={selected} agents={agents ?? []} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-sm text-muted-foreground">Select a conversation.</div>
          )}
        </section>
      </div>
    </div>
  );
}
