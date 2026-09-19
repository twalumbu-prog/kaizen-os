"use client";

import Link from "next/link";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import type { Doc } from "@/convex/_generated/dataModel";

export interface ReportStatusSummary {
  _id: string;
  name: string;
  cadence: string;
  validatorKey: string;
  latestStatus: "submitted" | "late" | "missing" | "pending" | string;
  submittedAt?: number;
  dueAt?: number;
  periodLabel?: string;
  qualityScore?: number | null;
}

export interface DepartmentLeadingSummary {
  department: Doc<"departments">;
  submissionRate: number;
  submittedCount: number;
  lateCount: number;
  missingCount: number;
  pendingCount: number;
  hasData?: boolean;
  healthScore: number;
  trend: { periodLabel: string; score: number }[];
}

export function LeadingMeasuresList({ departments }: { departments: DepartmentLeadingSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      {departments.map((d) => (
        <Card key={d.department._id} className="transition-all hover:shadow-sm border">
          <CardHeader className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3">
                <CardTitle className="text-base font-semibold">{d.department.name}</CardTitle>
                <Badge
                  variant={d.submissionRate >= 80 ? "default" : d.submissionRate >= 50 ? "outline" : "destructive"}
                  className="text-xs font-medium"
                >
                  {d.submissionRate}% Compliance
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
                <span className="text-green-600 dark:text-green-400 font-medium">{d.submittedCount} Submitted</span>
                <span>•</span>
                <span className="text-amber-600 dark:text-amber-400 font-medium">{d.lateCount} Late</span>
                <span>•</span>
                <span className="text-red-600 dark:text-red-400 font-medium">{d.missingCount} Missing</span>
                <span>•</span>
                <span className="text-blue-600 dark:text-blue-400 font-medium">{d.pendingCount} Pending</span>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden h-10 w-28 sm:block">
                <TrendSparkline data={d.trend} height={40} />
              </div>
              <StatusBadge score={d.healthScore} hasData={d.hasData} />
              <Link href={`/departments/${d.department._id}`}>
                <Button variant="outline" size="sm">
                  View Department Submissions <ChevronRight className="ml-1 size-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
