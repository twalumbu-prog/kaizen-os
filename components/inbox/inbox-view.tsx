"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { Bot, Inbox as InboxIcon, Plug } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Skeleton } from "@/components/ui/skeleton";
import { Conversation } from "@/components/inbox/conversation";
import { CHANNELS, agentColor, channelMeta, timeAgo, type Channel } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

type Status = "all" | "needs_human" | "open" | "resolved";

const STATUS_TABS: { id: Status; label: string }[] = [
  { id: "all", label: "All" },
  { id: "needs_human", label: "Needs you" },
  { id: "open", label: "Open" },
  { id: "resolved", label: "Resolved" },
];

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-sm font-medium transition-colors",
        active ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function FilterRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
      <span className="w-16 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function InboxFilters(props: {
  status: Status;
  onStatus: (s: Status) => void;
  channel: Channel | "";
  onChannel: (c: Channel | "") => void;
  agentId: string;
  onAgent: (id: string) => void;
  label: string;
  onLabel: (l: string) => void;
  draftsOnly: boolean;
  onDraftsOnly: (v: boolean) => void;
  agents: { _id: string; name: string }[];
  labels: string[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <FilterRow title="Status">
        {STATUS_TABS.map((t) => (
          <Pill key={t.id} active={props.status === t.id} onClick={() => props.onStatus(t.id)}>
            {t.label}
          </Pill>
        ))}
        <Pill active={props.draftsOnly} onClick={() => props.onDraftsOnly(!props.draftsOnly)}>
          Drafts to approve
        </Pill>
      </FilterRow>
      <FilterRow title="Channel">
        <Pill active={props.channel === ""} onClick={() => props.onChannel("")}>
          All
        </Pill>
        {CHANNELS.map((c) => (
          <Pill key={c.id} active={props.channel === c.id} onClick={() => props.onChannel(props.channel === c.id ? "" : c.id)}>
            {c.label}
          </Pill>
        ))}
      </FilterRow>
      {props.agents.length > 0 && (
        <FilterRow title="Agent">
          <Pill active={props.agentId === ""} onClick={() => props.onAgent("")}>
            All
          </Pill>
          {props.agents.map((a) => (
            <Pill key={a._id} active={props.agentId === a._id} onClick={() => props.onAgent(props.agentId === a._id ? "" : a._id)}>
              {a.name}
            </Pill>
          ))}
        </FilterRow>
      )}
      {props.labels.length > 0 && (
        <FilterRow title="Label">
          <Pill active={props.label === ""} onClick={() => props.onLabel("")}>
            All
          </Pill>
          {props.labels.map((l) => (
            <Pill key={l} active={props.label === l} onClick={() => props.onLabel(props.label === l ? "" : l)}>
              {l}
            </Pill>
          ))}
        </FilterRow>
      )}
    </div>
  );
}

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

      <InboxFilters
        status={status}
        onStatus={setStatus}
        channel={channel}
        onChannel={setChannel}
        agentId={agentId}
        onAgent={setAgentId}
        label={label}
        onLabel={setLabel}
        draftsOnly={draftsOnly}
        onDraftsOnly={setDraftsOnly}
        agents={agents ?? []}
        labels={allLabels}
      />

      <div className="grid min-h-[34rem] gap-4 lg:h-[calc(100vh-22rem)] lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border">
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
