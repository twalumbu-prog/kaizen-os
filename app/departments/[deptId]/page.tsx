"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronRight, Users, TrendingUp } from "lucide-react";

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

export default function DepartmentPage({
  params,
}: {
  params: Promise<{ deptId: Id<"departments"> }>;
}) {
  const { deptId } = use(params);
  const data = useQuery(api.dashboard.departmentDashboard, { departmentId: deptId });

  if (data === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (data === null) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Department not found.</p>
      </AppShell>
    );
  }

  // Category Outcome Status based solely on individual report status labels
  const evaluatedReportStatuses = data.reports
    .map((r) => {
      const val = (r as any).avgStudentCount ?? (r as any).latestStudentCount;
      const bench = r.template.outcomeBenchmark;
      if (val === null || val === undefined || !bench) return null;
      return getBenchmarkRating(val, bench);
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  const statusScores: Record<string, number> = {
    "Exceptional": 100,
    "Good Performance": 85,
    "Average": 70,
    "Below Target": 50,
    "Needs Improvement": 30,
  };

  const avgStatusScore =
    evaluatedReportStatuses.length > 0
      ? Math.round(
          evaluatedReportStatuses.reduce((sum, s) => sum + (statusScores[s.label] ?? 70), 0) /
            evaluatedReportStatuses.length
        )
      : null;

  const categoryRating =
    avgStatusScore !== null
      ? (() => {
          if (avgStatusScore >= 92) return { label: "Exceptional", badgeClass: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20" };
          if (avgStatusScore >= 80) return { label: "Good Performance", badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20" };
          if (avgStatusScore >= 65) return { label: "Average", badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20" };
          if (avgStatusScore >= 45) return { label: "Below Target", badgeClass: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20" };
          return { label: "Needs Improvement", badgeClass: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20" };
        })()
      : null;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        {/* Header Summary */}
        <Card className="border">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between pb-3">
            <div>
              <div className="flex items-center gap-3">
                <CardTitle className="text-xl">{data.department.name} Department</CardTitle>
                {categoryRating && (
                  <Badge variant="outline" className={`font-medium text-xs px-2.5 py-0.5 ${categoryRating.badgeClass}`}>
                    Category Status: {categoryRating.label}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Category Outcome Performance &amp; Report Status Summary
              </p>
            </div>
            <Badge variant="outline" className="text-xs font-semibold px-3 py-1 self-start sm:self-auto">
              {data.reports.length} Outcome {data.reports.length === 1 ? "Report" : "Reports"}
            </Badge>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-4 sm:grid-cols-3 border-t pt-4">
              <div>
                <div className="text-xs font-medium text-muted-foreground">Overall Category Outcome Status</div>
                <div className="text-2xl font-bold tracking-tight text-foreground">
                  {categoryRating ? categoryRating.label : "Pending Benchmarks"}
                </div>
                <div className="text-[11px] text-muted-foreground">Average rating across evaluated report statuses</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Evaluated Outcome Reports</div>
                <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
                  {evaluatedReportStatuses.length} / {data.reports.length}
                </div>
                <div className="text-[11px] text-muted-foreground">Reports with active benchmark targets</div>
              </div>
              <div>
                <div className="text-xs font-medium text-muted-foreground">Category Performance Index</div>
                <div className="text-2xl font-bold tracking-tight text-primary">
                  {avgStatusScore !== null ? `${avgStatusScore} / 100` : "—"}
                </div>
                <div className="text-[11px] text-muted-foreground">Combined status performance score</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Outcome Reports List View */}
        <div className="flex flex-col gap-4">
          <h2 className="text-base font-semibold tracking-tight">Category Reports &amp; Key Outcomes</h2>
          {data.reports.length === 0 ? (
            <p className="text-sm text-muted-foreground">No reports configured for this department yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {data.reports.map((r) => {
                const val = (r as any).avgStudentCount ?? (r as any).latestStudentCount ?? null;
                const benchmark = r.template.outcomeBenchmark;
                const rating = val !== null && benchmark ? getBenchmarkRating(val, benchmark) : null;
                const target = benchmark?.targetBenchmark;
                const outcomeTrend = (r as any).outcomeTrend ?? r.trend;

                return (
                  <Card key={r.template._id} className="transition-all hover:shadow-sm border">
                    <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                      {/* Left: Report Title & Benchmark Details */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                          <Users className="size-5" />
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/departments/${deptId}/reports/${r.template._id}`}
                            className="text-base font-semibold text-foreground hover:underline truncate block"
                          >
                            {r.template.name}
                          </Link>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-0.5">
                            <span className="capitalize">{r.template.cadence} cadence</span>
                            {benchmark?.metricLabel && (
                              <>
                                <span>•</span>
                                <span>Metric: {benchmark.metricLabel}</span>
                              </>
                            )}
                            {target !== undefined && (
                              <>
                                <span>•</span>
                                <span className="font-medium text-amber-700 dark:text-amber-400">
                                  Target Benchmark: {target}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Outcome Value, Status Badge, Progression Glimpse & Action */}
                      <div className="flex flex-wrap items-center gap-4 sm:gap-6 shrink-0">
                        {/* Extracted Outcome Value */}
                        <div className="text-right">
                          {val !== null ? (
                            <div className="text-lg font-bold tracking-tight text-foreground">
                              {val} <span className="text-xs font-normal text-muted-foreground">Students / Day</span>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground">No Extracted Data</div>
                          )}
                          <div className="text-[11px] text-muted-foreground">Actual Sales Volume</div>
                        </div>

                        {/* Outcome Performance Status Badge */}
                        <div>
                          {rating ? (
                            <Badge variant="outline" className={`font-medium text-xs py-1 px-2.5 ${rating.badgeClass}`}>
                              {rating.label}
                            </Badge>
                          ) : target !== undefined ? (
                            <Badge variant="outline" className="text-xs py-1 px-2.5">
                              Target: {target}
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs py-1 px-2.5">
                              Outcome Tracking
                            </Badge>
                          )}
                        </div>

                        {/* Progression Chart Sparkline Glimpse */}
                        <div className="flex flex-col items-center">
                          <div className="text-[10px] text-muted-foreground font-medium mb-1">
                            Outcome Glimpse
                          </div>
                          <div className="h-9 w-28">
                            <TrendSparkline data={outcomeTrend} height={36} />
                          </div>
                        </div>

                        {/* Action Link */}
                        <Link href={`/departments/${deptId}/reports/${r.template._id}`}>
                          <Button variant="outline" size="sm" className="h-9 gap-1">
                            Details <ChevronRight className="size-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
