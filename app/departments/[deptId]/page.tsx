"use client";

import { useQuery } from "convex/react";
import { use } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { ReportCard } from "@/components/dashboard/report-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DepartmentPage({
  params,
}: {
  params: Promise<{ deptId: Id<"departments"> }>;
}) {
  const { deptId } = use(params);
  const data = useQuery(api.dashboard.departmentDashboard, { departmentId: deptId });

  if (data === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  if (data === null) {
    return (
      <AppShell>
        <p className="text-sm text-muted-foreground">Department not found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">{data.department.name} Department</CardTitle>
            <StatusBadge score={data.healthScore} hasData={data.hasData} />
          </CardHeader>
          <CardContent className="flex items-end gap-6">
            <div className="text-5xl font-semibold tracking-tight">{data.healthScore}%</div>
            <div className="grid grid-cols-2 gap-x-6 text-sm text-muted-foreground">
              <div>Submission rate: <span className="text-foreground">{data.submissionRate}%</span></div>
              <div>Quality: <span className="text-foreground">{data.qualityScore}%</span></div>
            </div>
            <div className="h-16 flex-1">
              <TrendSparkline data={data.trend} height={64} />
            </div>
          </CardContent>
        </Card>

        {data.reports.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reports configured for this department yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.reports.map((r) => (
              <ReportCard
                key={r.template._id}
                template={r.template}
                hasData={r.hasData}
                healthScore={r.healthScore}
                submissionRate={r.submissionRate}
                qualityScore={r.qualityScore}
                trend={r.trend}
                lastSubmittedAt={r.lastSubmittedAt}
                missingCount={r.missingCount}
              />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
