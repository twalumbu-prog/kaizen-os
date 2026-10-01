"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/layout/back-button";
import { SubmissionChecklistView } from "@/components/reports/submission-checklist-view";
import { BankVarianceSection } from "@/components/reports/bank-variance-section";
import { Users, DollarSign, TrendingUp, ListChecks, Table2 } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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

function getBenchmarkRating(
  val: number,
  benchmark: { exceptional?: number; good?: number; average?: number; bad?: number; terrible?: number }
) {
  const { exceptional, good, average, bad, terrible } = benchmark;

  if (exceptional !== undefined && val >= exceptional) {
    return { label: "Exceptional", badgeClass: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20" };
  }
  if (good !== undefined && val >= good) {
    return { label: "Good Performance", badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" };
  }
  if (average !== undefined && val >= average) {
    return { label: "Average", badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20" };
  }
  if (bad !== undefined && val >= bad) {
    return { label: "Below Target", badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" };
  }
  if (terrible !== undefined && val <= terrible) {
    return { label: "Needs Improvement", badgeClass: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20" };
  }

  return null;
}

export default function ReportDetailPage({
  params,
}: {
  params: Promise<{ deptId: Id<"departments">; templateId: Id<"reportTemplates"> }>;
}) {
  const { templateId } = use(params);
  const data = useQuery(api.dashboard.reportDetail, { templateId });
  const [historyView, setHistoryView] = useState<"table" | "checklist">("table");

  if (data === undefined) {
    return (
      <AppShell>
        <BackButton fallbackHref="/" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (!data || !data.template) {
    return (
      <AppShell>
        <BackButton fallbackHref="/" />
        <p className="text-sm text-muted-foreground">Report not found.</p>
      </AppShell>
    );
  }

  const outcomeBenchmark = data.template.outcomeBenchmark;
  const isCanteen = data.template.validatorKey === "canteenSalesRecon";
  // Bank reconciliation is measured by the bank-vs-ledger variance, not an extracted outcome metric.
  const isBankRecon = data.template.validatorKey === "bankReconciliation";
  const varianceTolerance =
    data.template.validationRules.find((r) => r.key === "closingBalance")?.tolerance ?? 0.01;
  // Show the outcome column for any report with a configured outcome metric, not just canteen sales.
  const showOutcome = !isBankRecon && (isCanteen || !!outcomeBenchmark?.metricKey);
  const outcomeColumnLabel =
    outcomeBenchmark?.metricLabel || (isCanteen ? "Sales Volume (Student Count)" : "Outcome");
  const outcomeUnit = outcomeBenchmark?.metricLabel || "Students";
  const targetBenchmark = outcomeBenchmark?.targetBenchmark;
  const showBenchmarkOnChart = outcomeBenchmark?.showBenchmarkOnChart ?? true;

  const studentCounts = data.timeline
    .map((t) => t.studentCount)
    .filter((c): c is number => c !== null && c !== undefined);

  const totalStudents = studentCounts.reduce((sum, c) => sum + c, 0);
  const avgStudents = studentCounts.length > 0 ? Math.round(totalStudents / studentCounts.length) : 0;
  const rating = outcomeBenchmark ? getBenchmarkRating(avgStudents, outcomeBenchmark) : null;

  const canteenChartData = data.timeline
    .filter((entry) => entry.studentCount !== null && entry.studentCount !== undefined)
    .map((entry) => ({
      periodLabel: entry.submission.periodLabel,
      shortLabel: formatShortDate(entry.submission.periodLabel),
      studentCount: entry.studentCount,
      grandTotal: entry.grandTotal,
      targetBenchmark: targetBenchmark,
    }));

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <BackButton fallbackHref="/" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{data.template.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">{data.template.cadence} cadence</p>
        </div>

        {isBankRecon && (
          <BankVarianceSection
            tolerance={varianceTolerance}
            points={data.timeline.map((entry) => ({
              periodLabel: entry.submission.periodLabel,
              bankClosingBalance: entry.bankClosingBalance,
              ledgerClosingBalance: entry.ledgerClosingBalance,
              variance: entry.variance,
            }))}
          />
        )}

        {/* Extracted Outcome Summary Cards & Progression Chart */}
        {!isBankRecon && (outcomeBenchmark || isCanteen) && (
          <div className="flex flex-col gap-6">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Total Cumulative {outcomeBenchmark?.metricLabel || "Extracted Outcome"}
                  </CardTitle>
                  <Users className="size-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tracking-tight">{totalStudents.toLocaleString()}</div>
                  <p className="text-xs text-muted-foreground mt-1">Cumulatively extracted across reporting periods</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Average Outcome per Period
                  </CardTitle>
                  <TrendingUp className="size-4 text-primary" />
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline justify-between">
                    <div className="text-2xl font-bold tracking-tight">{avgStudents}</div>
                    {rating && (
                      <Badge variant="outline" className={`font-medium text-xs ${rating.badgeClass}`}>
                        {rating.label}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {targetBenchmark !== undefined
                      ? `Average vs target benchmark of ${targetBenchmark}`
                      : "Average metric value per report submission"}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    Outcome Metric Tracked
                  </CardTitle>
                  <DollarSign className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold tracking-tight">
                    {outcomeBenchmark?.metricLabel || "Sales Volume"}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {targetBenchmark !== undefined
                      ? `Target Benchmark: ${targetBenchmark}`
                      : "Extracted directly from submitted documents"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Progression Chart */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base">{outcomeBenchmark?.metricLabel || "Outcome"} Progression</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Extracted metric trend plotted against target benchmark
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {targetBenchmark !== undefined && (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20 font-medium">
                      Benchmark: {targetBenchmark}
                    </Badge>
                  )}
                  <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium">
                    <Users className="mr-1 size-3.5" />
                    Outcome Trend
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {canteenChartData.length < 2 ? (
                  <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                    Not enough historical report data to plot progression chart.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={280}>
                    <ComposedChart data={canteenChartData} margin={{ top: 10, right: 12, bottom: 0, left: -16 }}>
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
                          `${value}`,
                          name === "studentCount" ? (outcomeBenchmark?.metricLabel || "Extracted Outcome") : name,
                        ]}
                        labelFormatter={(_, payload) => payload?.[0]?.payload?.periodLabel ?? ""}
                        contentStyle={{ fontSize: 12, borderRadius: 8, padding: "8px 12px" }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
                      {showBenchmarkOnChart && targetBenchmark !== undefined && (
                        <Line
                          type="monotone"
                          dataKey="targetBenchmark"
                          name={`Target Benchmark (${targetBenchmark})`}
                          stroke="#f59e0b"
                          strokeDasharray="5 5"
                          strokeWidth={2}
                          dot={false}
                        />
                      )}
                      <Area
                        type="monotone"
                        dataKey="studentCount"
                        name={outcomeBenchmark?.metricLabel || "Extracted Outcome"}
                        stroke="#10b981"
                        strokeWidth={2.5}
                        fillOpacity={1}
                        fill="url(#studentCountGradient)"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Submission History &amp; Extracted Data</CardTitle>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryView((v) => (v === "table" ? "checklist" : "table"))}
            >
              {historyView === "table" ? (
                <>
                  <ListChecks className="mr-1.5 size-4" /> Checklist view
                </>
              ) : (
                <>
                  <Table2 className="mr-1.5 size-4" /> Table view
                </>
              )}
            </Button>
          </CardHeader>
          <CardContent>
            {historyView === "checklist" ? (
              <SubmissionChecklistView templateId={templateId} />
            ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead>Employee</TableHead>
                  <TableHead>Status</TableHead>
                  {showOutcome && <TableHead>{outcomeColumnLabel}</TableHead>}
                  {isBankRecon ? <TableHead>Variance</TableHead> : <TableHead>Outcome Rating</TableHead>}
                  <TableHead>Quality Score</TableHead>
                  <TableHead>Submission Time</TableHead>
                  <TableHead>Validation Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.timeline.map((entry) => {
                  const entryRating =
                    outcomeBenchmark && entry.studentCount !== null && entry.studentCount !== undefined
                      ? getBenchmarkRating(entry.studentCount, outcomeBenchmark)
                      : null;

                  return (
                    <TableRow key={entry.submission._id} className="cursor-pointer">
                      <TableCell>
                        <Link href={`/submissions/${entry.submission._id}`} className="hover:underline font-medium">
                          {entry.submission.periodLabel}
                        </Link>
                      </TableCell>
                      <TableCell>{entry.employeeName}</TableCell>
                      <TableCell className="capitalize">{entry.submission.status}</TableCell>
                      {showOutcome && (
                        <TableCell>
                          {entry.studentCount !== null && entry.studentCount !== undefined ? (
                            <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium">
                              <Users className="mr-1 size-3.5" />
                              {entry.studentCount} {outcomeUnit}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        {isBankRecon ? (
                          entry.variance !== null ? (
                            <span
                              className={`font-medium tabular-nums ${
                                Math.abs(entry.variance) > varianceTolerance ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"
                              }`}
                            >
                              {entry.variance > 0 ? "+" : entry.variance < 0 ? "-" : ""}
                              {Math.abs(entry.variance).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )
                        ) : entryRating ? (
                          <Badge variant="outline" className={`font-medium text-xs ${entryRating.badgeClass}`}>
                            {entryRating.label}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
