"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Bot, Plus, ShieldCheck } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { AgentForm } from "@/components/agents/agent-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNELS, MODE_LABEL, agentColor } from "@/lib/inbox-ui";
import { cn } from "@/lib/utils";

export default function AgentsPage() {
  const me = useQuery(api.profiles.getMe);
  const agents = useQuery(api.agents.list);
  const [editing, setEditing] = useState<Id<"agents"> | "new" | null>(null);
  const isAdmin = me?.role === "admin";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Bot className="size-6 text-violet-500" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Agents</h1>
              <p className="text-sm text-muted-foreground">
                AI teammates with a role and instructions. They read incoming messages and answer on your behalf.
              </p>
            </div>
          </div>
          {isAdmin && editing === null && (
            <Button onClick={() => setEditing("new")}>
              <Plus /> New agent
            </Button>
          )}
        </div>

        {editing === "new" && agents && (
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-4 text-base font-semibold">New agent</h2>
              <AgentForm others={agents} onDone={() => setEditing(null)} />
            </CardContent>
          </Card>
        )}

        {agents === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : agents.length === 0 && editing !== "new" ? (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No agents yet. Create a “Customer Service” agent to start answering your inbox
              {isAdmin ? "" : " — ask an admin to set one up"}.
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {agents.map((a) => {
              const color = agentColor(a.color);
              return (
                <Card key={a._id}>
                  <CardContent className="p-5">
                    {editing === a._id ? (
                      <AgentForm agent={a} others={agents} onDone={() => setEditing(null)} />
                    ) : (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("size-2.5 rounded-full", color.dot)} />
                            <h3 className="text-base font-semibold">{a.name}</h3>
                            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", color.chip)}>{a.title}</span>
                            {a.isSupervisor && (
                              <Badge variant="outline" className="gap-1">
                                <ShieldCheck className="size-3" /> Supervisor
                              </Badge>
                            )}
                            <Badge variant={a.mode === "auto" ? "default" : "secondary"}>{MODE_LABEL[a.mode]}</Badge>
                          </div>
                          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                            {a.instructions || "No instructions yet."}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                            {a.channels.length === 0 && <span>No channels</span>}
                            {a.channels.map((c) => {
                              const ch = CHANNELS.find((x) => x.id === c)!;
                              return (
                                <span key={c} className={cn("rounded-full px-2 py-0.5", ch.badge)}>
                                  {ch.label}
                                </span>
                              );
                            })}
                            <span className="ml-1">· {a.model}</span>
                          </div>
                        </div>
                        {isAdmin && (
                          <Button variant="outline" size="sm" onClick={() => setEditing(a._id)}>
                            Edit
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
