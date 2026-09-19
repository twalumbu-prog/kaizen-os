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
  }[];
}

export function KeyOutcomesList({ departments }: { departments: DepartmentOutcomeSummary[] }) {
  return (
    <div className="flex flex-col gap-4">
      {departments.map((d) => (
        <Card key={d.department._id} className="transition-all hover:shadow-sm border">
          <CardHeader className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-base font-semibold">{d.department.name}</CardTitle>
              <Badge variant="outline" className="text-xs font-medium">
                Quality: {d.qualityScore}%
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden h-10 w-28 sm:block">
                <TrendSparkline data={d.trend} height={40} />
              </div>
              <StatusBadge score={d.healthScore} hasData={d.hasData} />
              <Link href={`/departments/${d.department._id}`}>
                <Button variant="outline" size="sm">
                  View Outcome Details <ChevronRight className="ml-1 size-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
