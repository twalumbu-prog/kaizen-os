"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { PeriodRow } from "@/components/employee/score-tab";

/** Score-tab style view of a report: overall progress bar plus one expandable row per submission with its checklist. */
export function SubmissionChecklistView({ templateId }: { templateId: Id<"reportTemplates"> }) {
  const data = useQuery(api.dashboard.reportChecklists, { templateId });

  if (data === undefined) return <Skeleton className="h-40 w-full" />;
  if (data === null || data.periods.length === 0) {
    return <p className="text-sm text-muted-foreground">No submissions yet.</p>;
  }

  const pct = data.possible > 0 ? (data.earned / data.possible) * 100 : 0;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Progress value={pct} />
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Score</span>
          <span className="font-medium tabular-nums">
            {data.earned}/{data.possible}
          </span>
        </div>
      </div>
      <div className="flex flex-col border-t pt-1">
        {data.periods.map((period) => (
          <PeriodRow key={period.submissionId} period={period} periodKey={`${templateId}-${period.periodLabel}`} />
        ))}
      </div>
    </div>
  );
}
