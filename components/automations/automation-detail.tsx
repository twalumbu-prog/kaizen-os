"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { Download } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const STATUS_CLASS: Record<string, string> = {
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  skipped: "bg-muted text-muted-foreground",
  failed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
  running: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
};

export function RunStatus({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={`capitalize ${STATUS_CLASS[status] ?? ""}`}>
      {status}
    </Badge>
  );
}

export const fmt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString() : "—");
const signed = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n}`);

export function AutomationDetail({ automationId }: { automationId: Id<"automations"> }) {
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

