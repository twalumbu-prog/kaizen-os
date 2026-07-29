"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, AlertTriangle, ArrowRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

const CHECKLIST_ICON = {
  pass: <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />,
  fail: <XCircle className="size-4 shrink-0 text-red-500" />,
  warning: <AlertTriangle className="size-4 shrink-0 text-amber-500" />,
};

type ReportScore = NonNullable<ReturnType<typeof useQuery<typeof api.submissions.myReportScores>>>[number];
type PeriodScore = ReportScore["periods"][number];

function PeriodRow({ period, periodKey }: { period: PeriodScore; periodKey: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const hasChecklist = period.checklist.length > 0;
  const pct = period.possible > 0 ? Math.round((period.earned / period.possible) * 100) : 0;

  return (
    <div className="border-t first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 py-3 text-left hover:opacity-80"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex-1">
          <div className="font-medium">{period.periodLabel}</div>
          <div className="text-xs text-muted-foreground">
            Due {new Date(period.dueAt).toLocaleDateString()} · {period.status}
          </div>
        </div>
        <StatusBadge score={pct} hasData={hasChecklist} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {period.earned}/{period.possible}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 pb-3 pl-7">
          <div className="flex flex-col gap-2">
            {hasChecklist ? (
              period.checklist.map((item, i) => (
                <div key={`${periodKey}-${i}`} className="flex items-start gap-2 text-sm">
                  {CHECKLIST_ICON[item.status]}
                  <div>
                    <div className="font-medium">
                      {item.title}{" "}
                      <span className="font-normal text-muted-foreground">
                        ({item.points}/{item.maxPoints})
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">{item.explanation}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">Not yet submitted.</p>
            )}
          </div>
          
          <div className="pt-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => router.push(`/employee?tab=reports&date=${period.dueAt}`)}
            >
              View on Calendar <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({ report }: { report: ReportScore }) {
  const [expanded, setExpanded] = useState(false);
  const pct = report.possible > 0 ? (report.earned / report.possible) * 100 : 0;

  return (
    <Card>
      <button type="button" onClick={() => setExpanded((e) => !e)} className="w-full text-left">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{report.templateName}</CardTitle>
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Progress value={pct} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Score</span>
            <span className="font-medium tabular-nums">
              {report.earned}/{report.possible}
            </span>
          </div>
        </CardContent>
      </button>

      {expanded && (
        <CardContent className={cn("flex flex-col divide-y-0 border-t pt-2")}>
          {report.periods.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">No periods due yet this year.</p>
          ) : (
            report.periods.map((period) => (
              <PeriodRow key={period.periodLabel} period={period} periodKey={`${report.templateId}-${period.periodLabel}`} />
            ))
          )}
        </CardContent>
      )}
    </Card>
  );
}

export function ScoreTab() {
  const scores = useQuery(api.submissions.myReportScores);

  if (scores === undefined) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }

  if (scores.length === 0) {
    return <p className="text-sm text-muted-foreground">No reports assigned yet.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {scores.map((report) => (
        <ScoreCard key={report.templateId} report={report} />
      ))}
    </div>
  );
}
