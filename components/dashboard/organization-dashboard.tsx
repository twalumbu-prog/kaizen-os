"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { LeadingMeasuresCard } from "@/components/dashboard/leading-measures-card";
import { KeyOutcomesCard } from "@/components/dashboard/key-outcomes-card";
import { KeyOutcomesList } from "@/components/dashboard/key-outcomes-list";
import { WorkCalendar } from "@/components/calendar/work-calendar";
import { ScoreTab } from "@/components/employee/score-tab";
import { DashboardTab } from "@/components/employee/dashboard-tab";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Award, Calendar, Clock, Target } from "lucide-react";

export function OrganizationDashboard({ orgId }: { orgId: Id<"organizations"> }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "leading";
  const [showChart, setShowChart] = useState(false);

  const data = useQuery(api.dashboard.organizationDashboard, { orgId });

  if (data === undefined || data === null) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-lg">{data.organization?.name ?? "Organization"} Health</CardTitle>
          <StatusBadge score={data.healthScore} hasData={data.hasData} />
        </CardHeader>
        <CardContent className="flex items-end gap-6">
          <div className="text-5xl font-semibold tracking-tight">{data.healthScore}%</div>
          <div className="h-16 flex-1">
            <TrendSparkline data={data.trend} height={64} />
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => router.push(`/?tab=${v}`)} className="w-full space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="grid w-full max-w-xl grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="leading" className="flex items-center gap-2">
              <Clock className="size-4" />
              Leading
            </TabsTrigger>
            <TabsTrigger value="outcomes" className="flex items-center gap-2">
              <Target className="size-4" />
              Key Outcomes
            </TabsTrigger>
            <TabsTrigger value="reports" className="flex items-center gap-2">
              <Calendar className="size-4" />
              Reports
            </TabsTrigger>
            <TabsTrigger value="score" className="flex items-center gap-2">
              <Award className="size-4" />
              Score
            </TabsTrigger>
          </TabsList>
          {tab === "score" && (
            <Button variant="outline" size="sm" onClick={() => setShowChart(!showChart)}>
              {showChart ? "Hide Chart" : "Show Chart"}
            </Button>
          )}
        </div>

        <TabsContent value="leading" className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Leading Measures:</span> Tracks submission expectations, timeliness, and whether report requirements are submitted on time or missing. Arranged by department.
          </div>

          {data.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No departments yet.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.departments.map((d) => (
                <LeadingMeasuresCard
                  key={d.department._id}
                  department={d.department}
                  submissionRate={d.submissionRate}
                  submittedCount={d.submittedCount ?? 0}
                  lateCount={d.lateCount}
                  missingCount={d.missingCount}
                  pendingCount={d.pendingCount ?? 0}
                  reports={d.reports ?? []}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="outcomes" className="space-y-4">
          <div className="rounded-md border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">Key Outcomes:</span> Measures performance quality and accuracy outcomes extracted from submitted documents across departments. Arranged by department in a list format.
          </div>

          {data.departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No departments yet.</p>
          ) : (
            <KeyOutcomesList departments={data.departments} />
          )}
        </TabsContent>

        <TabsContent value="reports" className="space-y-4">
          <WorkCalendar />
        </TabsContent>

        <TabsContent value="score" className="space-y-6">
          <DashboardTab />
          <ScoreTab showChart={showChart} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
