"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import type { Doc } from "@/convex/_generated/dataModel";

export function ReportCard({
  template,
  hasData = true,
  healthScore,
  submissionRate,
  qualityScore,
  trend,
  lastSubmittedAt,
  missingCount,
}: {
  template: Doc<"reportTemplates">;
  hasData?: boolean;
  healthScore: number;
  submissionRate: number;
  qualityScore: number;
  trend: { periodLabel: string; score: number }[];
  lastSubmittedAt?: number;
  missingCount: number;
}) {
  return (
    <Link href={`/departments/${template.departmentId}/reports/${template._id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <CardTitle className="text-base">{template.name}</CardTitle>
          <StatusBadge score={healthScore} hasData={hasData} />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-3xl font-semibold tracking-tight">{healthScore}%</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <div>Submission: <span className="text-foreground">{submissionRate}%</span></div>
            <div>Quality: <span className="text-foreground">{qualityScore}%</span></div>
            <div>
              Last submitted:{" "}
              <span className="text-foreground">
                {lastSubmittedAt ? new Date(lastSubmittedAt).toLocaleDateString() : "Never"}
              </span>
            </div>
            <div>Missing: <span className="text-foreground">{missingCount}</span></div>
          </div>
          <TrendSparkline data={trend} />
        </CardContent>
      </Card>
    </Link>
  );
}
