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
    <div className="flex flex-col gap-6">
      {departments.map((d) => (
        <Card key={d.department._id} className="transition-all hover:shadow-sm border">
          <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base font-semibold">{d.department.name}</CardTitle>
                <Badge variant="outline" className="text-[11px] font-normal">
                  Quality: {d.qualityScore}%
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Extracted Outcomes &amp; Document Quality Verification
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden h-10 w-24 sm:block">
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
          <CardContent>
            {d.reports.length === 0 ? (
              <p className="text-xs text-muted-foreground italic py-2">No outcome reports evaluated yet.</p>
            ) : (
              <div className="divide-y rounded-md border text-sm">
                {d.reports.map((r) => (
                  <div
                    key={r._id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-center gap-2.5 truncate">
                      <ShieldCheck className="size-4 shrink-0 text-primary" />
                      <Link
                        href={`/departments/${d.department._id}/reports/${r._id}`}
                        className="font-medium text-foreground hover:underline truncate flex items-center gap-1.5"
                      >
                        {r.name}
                        <ExternalLink className="size-3 text-muted-foreground" />
                      </Link>
                      <span className="text-xs text-muted-foreground capitalize">({r.cadence})</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs">
                      {/* Canteen Sales Volume (Student Count) Extracted Outcome */}
                      {r.validatorKey === "canteenSalesRecon" && r.studentCount !== null && r.studentCount !== undefined && (
                        <Badge
                          variant="secondary"
                          className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20 font-medium py-1 px-2.5 flex items-center gap-1.5"
                        >
                          <Users className="size-3.5" />
                          <span>{r.studentCount} Students Fed</span>
                          <span className="text-[10px] text-muted-foreground">(Sales Volume)</span>
                        </Badge>
                      )}

                      {r.qualityScore !== null ? (
                        <Badge variant="outline" className="font-semibold text-foreground">
                          {r.qualityScore}% Passed
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">No Data Extracted</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
