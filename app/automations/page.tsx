"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { Download, Play, Workflow } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STATUS_CLASS: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  skipped: "bg-muted text-muted-foreground",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
};

function RunStatus({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`capitalize ${STATUS_CLASS[status] ?? ""}`}>
      {status}
    </Badge>
  );
}

const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "—");
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}`);

function AutomationDetail({ automationId }: { automationId: Id<"automations"> }) {
  const runs = useQuery(api.automations.runs, { automationId });
  const work = useQuery(api.automations.submittedWork, { automationId });

  return (
    <Tabs defaultValue="work" className="mt-4">
      <TabsList>
        <TabsTrigger value="work">Submitted work</TabsTrigger>
        <TabsTrigger value="history">Run history</TabsTrigger>
      </TabsList>

      <TabsContent value="work">
        {work === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : work.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing submitted yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead>Deviation</TableHead>
                <TableHead>Submitted</TableHead>
                <TableHead>Report</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {work.map((w) => (
                <TableRow key={w.submissionId}>
                  <TableCell>
                    <Link href={`/submissions/${w.submissionId}`} className="font-medium hover:underline">
                      {w.periodLabel}
                    </Link>
                  </TableCell>
                  <TableCell>{w.expected ?? "—"}</TableCell>
                  <TableCell>{w.actual ?? "—"}</TableCell>
                  <TableCell>{signed(w.deviation)}</TableCell>
                  <TableCell>{fmt(w.submittedAt)}</TableCell>
                  <TableCell>
                    {w.url ? (
                      <a
                        href={w.url}
                        download={w.fileName ?? undefined}
                        className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      >
                        <Download className="size-3.5" /> {w.fileName ?? "Download"}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>

      <TabsContent value="history">
        {runs === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : runs.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">It hasn&apos;t run yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Started</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Dates</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r._id}>
                  <TableCell className="whitespace-nowrap">{fmt(r.startedAt)}</TableCell>
                  <TableCell className="capitalize">{r.trigger}</TableCell>
                  <TableCell>
                    <RunStatus status={r.status} />
                  </TableCell>
                  <TableCell>{r.datesProcessed.length ? r.datesProcessed.join(", ") : "—"}</TableCell>
                  <TableCell className="max-w-md whitespace-normal text-sm text-muted-foreground">
                    {r.message}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TabsContent>
    </Tabs>
  );
}

export default function AutomationsPage() {
  const me = useQuery(api.profiles.getMe);
  const automations = useQuery(api.automations.list);
  const setEnabled = useMutation(api.automations.setEnabled);
  const runNow = useMutation(api.automations.runNow);
  const [busy, setBusy] = useState<string | null>(null);
  const isAdmin = me?.role === "admin";

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Workflow className="size-6 text-violet-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
            <p className="text-sm text-muted-foreground">
              Jobs that run on a schedule, the reports they submit, and every time they have run.
            </p>
          </div>
        </div>

        {automations === undefined ? (
          <Skeleton className="h-40 w-full" />
        ) : automations.length === 0 ? (
          <p className="text-sm text-muted-foreground">No automations are set up for this organization.</p>
        ) : (
          automations.map((a) => (
            <Card key={a._id}>
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="max-w-2xl">
                    <CardTitle>{a.name}</CardTitle>
                    <CardDescription className="mt-1">{a.description}</CardDescription>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {a.schedule}
                      {a.outputTemplateName ? ` · Submits to “${a.outputTemplateName}”` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{a.enabled ? "Enabled" : "Paused"}</span>
                      <Switch
                        checked={a.enabled}
                        disabled={!isAdmin}
                        onCheckedChange={(enabled) =>
                          setEnabled({ automationId: a._id, enabled }).catch((e) => toast.error(e.message))
                        }
                      />
                    </div>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy === a._id}
                        onClick={async () => {
                          setBusy(a._id);
                          try {
                            await runNow({ automationId: a._id });
                            toast.success("Started — the result will appear in Run history.");
                          } catch (e) {
                            toast.error(e instanceof Error ? e.message : "Could not start");
                          } finally {
                            setBusy(null);
                          }
                        }}
                      >
                        <Play className="mr-1 size-3.5" /> Run now
                      </Button>
                    )}
                    {a.lastRun && (
                      <p className="text-xs text-muted-foreground">
                        Last run {fmt(a.lastRun.startedAt)} · <RunStatus status={a.lastRun.status} />
                      </p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <AutomationDetail automationId={a._id} />
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </AppShell>
  );
}
