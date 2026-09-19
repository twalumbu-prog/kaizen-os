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

function getCategoryOutcomeSummary(department: DepartmentOutcomeSummary) {
  const evaluatedReports = department.reports.filter(
    (r) => r.studentCount !== null && r.studentCount !== undefined && r.outcomeBenchmark?.targetBenchmark !== undefined
  );

  if (evaluatedReports.length === 0) {
    const reportsWithValues = department.reports.filter((r) => r.studentCount !== null && r.studentCount !== undefined);
    if (reportsWithValues.length > 0) {
      const avgVal = Math.round(reportsWithValues.reduce((sum, r) => sum + (r.studentCount ?? 0), 0) / reportsWithValues.length);
      return {
        label: "Outcome Data Active",
        badgeClass: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
        detailText: `Average Volume: ${avgVal} per report across category`,
      };
    }
    return {
      label: "Pending Benchmarks",
      badgeClass: "bg-muted text-muted-foreground border-border",
      detailText: "Awaiting outcome data & benchmark configuration for this category",
    };
  }

  let totalPct = 0;
  let totalActual = 0;
  let totalTarget = 0;

  for (const r of evaluatedReports) {
    const actual = r.studentCount!;
    const target = r.outcomeBenchmark!.targetBenchmark!;
    totalActual += actual;
    totalTarget += target;
    totalPct += (actual / target) * 100;
  }

  const avgPct = Math.round(totalPct / evaluatedReports.length);
  const avgActual = Math.round(totalActual / evaluatedReports.length);
  const avgTarget = Math.round(totalTarget / evaluatedReports.length);

  let label = "Average";
  let badgeClass = "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";

  if (avgPct >= 115) {
    label = "Exceptional";
    badgeClass = "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-500/20";
  } else if (avgPct >= 100) {
    label = "Good Performance";
    badgeClass = "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20";
  } else if (avgPct >= 85) {
    label = "Average";
    badgeClass = "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20";
  } else if (avgPct >= 65) {
    label = "Below Target";
    badgeClass = "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20";
  } else {
    label = "Needs Improvement";
    badgeClass = "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20";
  }

  return {
    label,
    badgeClass,
    detailText: `Category Avg Outcome: ${avgActual} vs Target: ${avgTarget} (${avgPct}% Target Achievement)`,
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
