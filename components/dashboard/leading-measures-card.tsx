"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, XCircle, CheckCircle2, FileText, ChevronRight } from "lucide-react";
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

export function LeadingMeasuresCard({
  department,
  submissionRate,
  submittedCount,
  lateCount,
  missingCount,
  pendingCount,
  reports,
}: {
  department: Doc<"departments">;
  submissionRate: number;
  submittedCount: number;
  lateCount: number;
  missingCount: number;
  pendingCount: number;
  reports: ReportStatusSummary[];
}) {
  return (
    <Card className="flex flex-col justify-between transition-all hover:shadow-md border">
      <div>
        <CardHeader className="flex flex-row items-start justify-between gap-2 pb-3">
          <div>
            <CardTitle className="text-base font-semibold">{department.name}</CardTitle>
            <CardDescription className="text-xs">
              {reports.length} expected report{reports.length === 1 ? "" : "s"}
            </CardDescription>
          </div>
          <Badge
            variant={submissionRate >= 80 ? "default" : submissionRate >= 50 ? "outline" : "destructive"}
            className="text-xs"
          >
            {submissionRate}% Compliance
          </Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Summary Stat Grid */}
          <div className="grid grid-cols-4 gap-2 rounded-lg bg-muted/50 p-2 text-center text-xs">
            <div>
              <div className="text-muted-foreground">Submitted</div>
              <div className="font-semibold text-green-600 dark:text-green-400">{submittedCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Late</div>
              <div className="font-semibold text-amber-600 dark:text-amber-400">{lateCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Missing</div>
              <div className="font-semibold text-red-600 dark:text-red-400">{missingCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Pending</div>
              <div className="font-semibold text-blue-600 dark:text-blue-400">{pendingCount}</div>
            </div>
          </div>

          {/* Submission Expectations List */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Submission Expectations & Status</div>
            {reports.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No required reports set up.</p>
            ) : (
              <div className="divide-y rounded-md border text-xs">
                {reports.slice(0, 5).map((r) => (
                  <div key={r._id} className="flex items-center justify-between px-3 py-2">
                    <div className="flex items-center gap-2 truncate pr-2">
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground capitalize">({r.cadence})</span>
                    </div>

                    <div>
                      {r.latestStatus === "submitted" && (
                        <span className="inline-flex items-center gap-1 rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-950 dark:text-green-300">
                          <CheckCircle2 className="size-3" /> Submitted
                        </span>
                      )}
                      {r.latestStatus === "late" && (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                          <AlertTriangle className="size-3" /> Submitted Late
                        </span>
                      )}
                      {r.latestStatus === "missing" && (
                        <span className="inline-flex items-center gap-1 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                          <XCircle className="size-3" /> Missing
                        </span>
                      )}
                      {r.latestStatus === "pending" && (
                        <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                          <Clock className="size-3" /> Pending
                        </span>
                      )}
                    </div>
                  </div>
                ))}
                {reports.length > 5 && (
                  <div className="px-3 py-1.5 text-center text-[11px] text-muted-foreground">
                    +{reports.length - 5} more report requirements
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
          View Department Submissions <ChevronRight className="size-3" />
        </Link>
      </div>
    </Card>
  );
}
