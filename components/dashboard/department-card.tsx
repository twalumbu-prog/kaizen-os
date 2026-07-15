"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import type { Doc } from "@/convex/_generated/dataModel";

export function DepartmentCard({
  department,
  hasData = true,
  healthScore,
  submissionRate,
  qualityScore,
  lateCount,
  missingCount,
  trend,
}: {
  department: Doc<"departments">;
  hasData?: boolean;
  healthScore: number;
  submissionRate: number;
  qualityScore: number;
  lateCount: number;
  missingCount: number;
  trend: { periodLabel: string; score: number }[];
}) {
  return (
    <Link href={`/departments/${department._id}`}>
      <Card className="transition-shadow hover:shadow-md">
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
          <CardTitle className="text-base">{department.name}</CardTitle>
          <StatusBadge score={healthScore} hasData={hasData} />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="text-3xl font-semibold tracking-tight">{healthScore}%</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <div>Submission rate: <span className="text-foreground">{submissionRate}%</span></div>
            <div>Quality: <span className="text-foreground">{qualityScore}%</span></div>
            <div>Late: <span className="text-foreground">{lateCount}</span></div>
            <div>Missing: <span className="text-foreground">{missingCount}</span></div>
          </div>
          <TrendSparkline data={trend} />
        </CardContent>
      </Card>
    </Link>
  );
}
