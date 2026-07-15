"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ deptId: Id<"departments">; templateId: Id<"reportTemplates"> }>;
}) {
  const { templateId } = use(params);
  const data = useQuery(api.dashboard.reportDetail, { templateId });

  if (data === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (!data || !data.template) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Report not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.template.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{data.template.cadence} cadence</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            {data.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {data.timeline.map((entry) => (
                  <div
                    key={entry.submission._id}
                    className="flex min-w-40 flex-col gap-1 rounded-lg border p-3 text-sm"
                  >
                    <span className="font-medium">{entry.submission.periodLabel}</span>
                    <span className="text-muted-foreground capitalize">{entry.submission.status}</span>
                    <StatusBadge score={entry.submission.finalScore ?? 0} />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quality Score</TableHead>
                  <TableHead>Submission Time</TableHead>
                  <TableHead>Validation Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.timeline.map((entry) => (
                  <TableRow key={entry.submission._id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/submissions/${entry.submission._id}`} className="hover:underline">
                        {entry.submission.periodLabel}
                      </Link>
                    </TableCell>
                    <TableCell>{entry.employeeName}</TableCell>
                    <TableCell className="capitalize">{entry.submission.status}</TableCell>
                    <TableCell>{entry.qualityScore !== undefined ? `${entry.qualityScore}%` : "—"}</TableCell>
                    <TableCell>
                      {entry.submission.submittedAt
                        ? new Date(entry.submission.submittedAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {entry.submission.finalScore !== undefined ? (
                        <StatusBadge score={entry.submission.finalScore} />
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
