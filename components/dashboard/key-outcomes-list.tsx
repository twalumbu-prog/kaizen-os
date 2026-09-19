"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Target } from "lucide-react";
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

function getReportStatus(
  val: number,
  benchmark: { exceptional?: number; good?: number; average?: number; bad?: number; terrible?: number }
) {
  const { exceptional, good, average, bad, terrible } = benchmark;

  if (exceptional !== undefined && val >= exceptional) return { key: "exceptional", label: "Exceptional", score: 100 };
  if (good !== undefined && val >= good) return { key: "good", label: "Good Performance", score: 85 };
  if (average !== undefined && val >= average) return { key: "average", label: "Average", score: 70 };
  if (bad !== undefined && val >= bad) return { key: "bad", label: "Below Target", score: 50 };
  if (terrible !== undefined && val <= terrible) return { key: "terrible", label: "Needs Improvement", score: 30 };

  return null;
}

function getCategoryOutcomeSummary(department: DepartmentOutcomeSummary) {
  const reportStatuses = department.reports
    .map((r) => {
      const val = r.studentCount;
      const bench = r.outcomeBenchmark;
      if (val === null || val === undefined || !bench) return null;
      return getReportStatus(val, bench);
    })
    .filter((s): s is NonNullable<typeof s> => s !== null);

  if (reportStatuses.length === 0) {
    return {
      label: "Pending Benchmarks",
      badgeClass: "bg-muted text-muted-foreground border-border",
      detailText: "No evaluated report outcome statuses available yet for this category",
    };
  }

  const avgScore = Math.round(reportStatuses.reduce((sum, s) => sum + s.score, 0) / reportStatuses.length);

  let label = "Average";
  let badgeClass = "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";

  if (avgScore >= 92) {
    label = "Exceptional";
    badgeClass = "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
  } else if (avgScore >= 80) {
    label = "Good Performance";
    badgeClass = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  } else if (avgScore >= 65) {
    label = "Average";
    badgeClass = "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  } else if (avgScore >= 45) {
    label = "Below Target";
    badgeClass = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  } else {
    label = "Needs Improvement";
    badgeClass = "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
  }

  const statusSummaryText = reportStatuses.map((s) => s.label).join(", ");

  return {
    label,
    badgeClass,
    detailText: `Category Status: ${label} (Evaluated Reports: ${statusSummaryText})`,
  };
}

export function KeyOutcomesList({ departments }: { departments: DepartmentOutcomeSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      {departments.map((d) => {
        const summary = getCategoryOutcomeSummary(d);
        return (
          <Card key={d.department._id} className="transition-all hover:shadow-sm border">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <h3 className="text-base font-semibold tracking-tight">{d.department.name} Category</h3>
                  <Badge variant="outline" className={`font-medium text-xs ${summary.badgeClass}`}>
                    {summary.label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{summary.detailText}</p>
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
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
