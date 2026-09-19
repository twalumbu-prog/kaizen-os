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
import { Badge } from "@/components/ui/badge";
import { Users, DollarSign, TrendingUp } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatShortDate(label: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    const date = new Date(`${label}T00:00:00Z`);
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  }
  return label;
}

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

  const isCanteen = data.template.validatorKey === "canteenSalesRecon";
  const studentCounts = data.timeline
    .map((t) => t.studentCount)
    .filter((c): c is number => c !== null && c !== undefined);

  const totalStudents = studentCounts.reduce((sum, c) => sum + c, 0);
  const avgStudents = studentCounts.length > 0 ? Math.round(totalStudents / studentCounts.length) : 0;

  const canteenChartData = data.timeline
    .filter((entry) => entry.studentCount !== null && entry.studentCount !== undefined)
    .map((entry) => ({
      periodLabel: entry.submission.periodLabel,
      shortLabel: formatShortDate(entry.submission.periodLabel),
      studentCount: entry.studentCount,
      grandTotal: entry.grandTotal,
    }));

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.template.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{data.template.cadence} cadence</p>
        </div>

        {/* Extracted Sales Volume Summary Cards for Canteen Sales Daily Report */}
        {isCanteen && (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Sales Volume (Student Count)
                  </CardTitle>
                  <Users className="size-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tracking-tight">{totalStudents.toLocaleString()} Students</div>
                  <p className="text-xs text-muted-foreground mt-1">Cumulatively fed across reporting periods</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Average Daily Student Volume
                  </CardTitle>
                  <TrendingUp className="size-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tracking-tight">{avgStudents} Students / Day</div>
                  <p className="text-xs text-muted-foreground mt-1">Average sales volume per daily report</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Outcome Tracking Metric
                  </CardTitle>
                  <DollarSign className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tracking-tight">Sales Volume</div>
                  <p className="text-xs text-muted-foreground mt-1">Extracted directly from daily collection recon sheets</p>
                </CardContent>
              </Card>
            </div>

            {/* Progression Chart */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">Sales Volume Progression</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Daily student count trend across reporting dates
                  </p>
                </div>
                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium">
                  <Users className="mr-1 size-3.5" />
                  Student Volume Trend
                </Badge>
              </CardHeader>
              <CardContent className="pt-4">
                {canteenChartData.length < 2 ? (
                  <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                    Not enough historical report data to plot progression chart.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={260}>
                    <AreaChart data={canteenChartData} margin={{ top: 10, right: 12, bottom: 0, left: -16 }}>
                      <defs>
                        <linearGradient id="studentCountGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0.0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.3} />
                      <XAxis
                        dataKey="shortLabel"
                        tick={{ fontSize: 12 }}
                        interval="preserveStartEnd"
                        tickLine={false}
                      />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={40} />
                      <Tooltip
                        formatter={(value: any, name: any) => [
                          name === "studentCount" ? `${value} Students` : `ZMW ${value}`,
                          name === "studentCount" ? "Sales Volume (Students)" : "Grand Total",
                        ]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.periodLabel ?? ""}
                        contentStyle={{ fontSize: 12, borderRadius: 8, padding: "8px 12px" }}
                      />
                      <Area
                        type="monotone"
                        dataKey="studentCount"
                        stroke="#10b981"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#studentCountGradient)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timeline &amp; Extracted Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            {data.timeline.length === 0 ? (
              <p className="text-sm text-muted-foreground">No submissions yet.</p>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-2">
                {data.timeline.map((entry) => (
                  <div
                    key={entry.submission._id}
                    className="flex min-w-44 flex-col gap-1.5 rounded-lg border p-3 text-sm"
                  >
                    <span className="font-medium">{entry.submission.periodLabel}</span>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground capitalize">{entry.submission.status}</span>
                      <StatusBadge score={entry.submission.finalScore ?? 0} />
                    </div>
                    {isCanteen && entry.studentCount !== null && entry.studentCount !== undefined && (
                      <Badge variant="secondary" className="mt-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 text-[11px] font-medium">
                        <Users className="mr-1 size-3" />
                        {entry.studentCount} Students
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submission History &amp; Extracted Data</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  {isCanteen && <TableHead>Sales Volume (Student Count)</TableHead>}
                  <TableHead>Quality Score</TableHead>
                  <TableHead>Submission Time</TableHead>
                  <TableHead>Validation Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.timeline.map((entry) => (
                  <TableRow key={entry.submission._id} className="cursor-pointer">
                    <TableCell>
                      <Link href={`/submissions/${entry.submission._id}`} className="hover:underline font-medium">
                        {entry.submission.periodLabel}
                      </Link>
                    </TableCell>
                    <TableCell>{entry.employeeName}</TableCell>
                    <TableCell className="capitalize">{entry.submission.status}</TableCell>
                    {isCanteen && (
                      <TableCell>
                        {entry.studentCount !== null && entry.studentCount !== undefined ? (
                          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium">
                            <Users className="mr-1 size-3.5" />
                            {entry.studentCount} Students
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
                    )}
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
