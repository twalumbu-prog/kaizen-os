"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { ShieldCheck, ChevronRight } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";
import type { ReportStatusSummary } from "./leading-measures-card";

export function KeyOutcomesCard({
  department,
  hasData = true,
  healthScore,
  qualityScore,
  trend,
  reports,
}: {
  department: Doc<"departments">;
  hasData?: boolean;
  healthScore: number;
  qualityScore: number;
  trend: { periodLabel: string; score: number }[];
  reports: ReportStatusSummary[];
}) {
  return (
    <Card className="flex flex-col justify-between transition-all hover:shadow-md border">
      <div>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base font-semibold">{department.name}</CardTitle>
            <CardDescription className="text-xs">Extracted Data & Performance Outcomes</CardDescription>
          </div>
          <StatusBadge score={healthScore} hasData={hasData} />
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Key Outcome Metrics */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div>
              <div className="text-xs text-muted-foreground">Data Quality Score</div>
              <div className="text-2xl font-bold tracking-tight text-foreground">{qualityScore}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Overall Health</div>
              <div className="text-2xl font-bold tracking-tight text-primary">{healthScore}%</div>
            </div>
            <div className="h-10 w-24">
              <TrendSparkline data={trend} height={40} />
            </div>
          </div>

          {/* Extracted Outcomes Breakdown per Report */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Required Document Verification Outcomes</div>
            {reports.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No reports evaluated yet.</p>
            ) : (
              <div className="divide-y rounded-md border text-xs">
                {reports.slice(0, 5).map((r) => (
                  <div key={r._id} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2 truncate pr-2">
                      <ShieldCheck className="size-3.5 shrink-0 text-primary" />
                      <span className="truncate font-medium">{r.name}</span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {r.qualityScore !== null ? (
                        <span className="font-semibold text-foreground">{r.qualityScore}% Passed</span>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">No Data Extracted</span>
                      )}
                    </div>
                  </div>
                ))}
                {reports.length > 5 && (
                  <div className="px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                    +{reports.length - 5} more outcome reports
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </div>

      <div className="p-4 pt-0">
        <Link
          href={`/departments/${department._id}`}
          className="inline-flex w-full items-center justify-center gap-1 text-xs font-medium text-primary hover:underline pt-2 border-t"
        >
          View Outcome Details <ChevronRight className="size-3" />
        </Link>
      </div>
    </Card>
  );
}
