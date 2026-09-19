"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ChevronRight, Users, ExternalLink } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

export interface DepartmentOutcomeSummary {
  department: Doc<"departments">;
  hasData?: boolean;
  healthScore: number;
  qualityScore: number;
  trend: { periodLabel: string; score: number }[];
  reports: {
    _id: string;
    name: string;
    cadence: string;
    validatorKey: string;
    latestStatus: string;
    submittedAt?: number;
    dueAt?: number;
    periodLabel?: string;
    qualityScore: number | null;
    studentCount?: number | null;
    grandTotal?: number | null;
    outcomeBenchmark?: {
      metricLabel?: string;
      targetBenchmark?: number;
      showBenchmarkOnChart?: boolean;
      exceptional?: number;
      good?: number;
      average?: number;
      bad?: number;
      terrible?: number;
    };
  }[];
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

export function KeyOutcomesList({ departments }: { departments: DepartmentOutcomeSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      {departments.map((d) => (
        <Card key={d.department._id} className="transition-all hover:shadow-sm border">
          <CardHeader className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between border-b bg-muted/20">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-semibold">{d.department.name}</CardTitle>
              <Badge variant="outline" className="text-xs font-medium bg-background">
                {d.reports.length} Outcome {d.reports.length === 1 ? "Report" : "Reports"}
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden h-10 w-28 sm:block">
                <TrendSparkline data={d.trend} height={40} />
              </div>
              <Link href={`/departments/${d.department._id}`}>
                <Button variant="outline" size="sm">
                  View Outcome Details <ChevronRight className="ml-1 size-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="pt-4 space-y-3">
            {d.reports.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No outcome reports configured.</p>
            ) : (
              <div className="divide-y rounded-md border text-xs bg-card">
                {d.reports.map((r) => {
                  const val = r.studentCount ?? null;
                  const benchmark = r.outcomeBenchmark;
                  const rating = val !== null && benchmark ? getBenchmarkRating(val, benchmark) : null;
                  const target = benchmark?.targetBenchmark;

                  return (
                    <div key={r._id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2.5 truncate">
                        <Users className="size-4 shrink-0 text-emerald-600" />
                        <div>
                          <Link href={`/departments/${d.department._id}/reports/${r._id}`} className="font-semibold text-foreground hover:underline">
                            {r.name}
                          </Link>
                          <div className="text-[11px] text-muted-foreground">
                            {benchmark?.metricLabel || "Sales Volume"} {target !== undefined ? `· Target: ${target}` : ""}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {val !== null ? (
                          <span className="font-semibold text-foreground">{val} Students</span>
                        ) : (
                          <span className="text-muted-foreground text-[11px]">No Extracted Data</span>
                        )}

                        {rating ? (
                          <Badge variant="outline" className={`font-medium text-xs ${rating.badgeClass}`}>
                            {rating.label}
                          </Badge>
                        ) : target !== undefined ? (
                          <Badge variant="outline" className="text-[11px]">
                            Target: {target}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
