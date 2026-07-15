"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { TrendSparkline } from "@/components/dashboard/trend-sparkline";
import { DepartmentCard } from "@/components/dashboard/department-card";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function OrganizationDashboard({ orgId }: { orgId: Id<"organizations"> }) {
  const data = useQuery(api.dashboard.organizationDashboard, { orgId });

  if (data === undefined) {
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
        <CardHeader className="flex flex-row items-center justify-between">
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

      {data.departments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No departments yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.departments.map((d) => (
            <DepartmentCard
              key={d.department._id}
              department={d.department}
              hasData={d.hasData}
              healthScore={d.healthScore}
              submissionRate={d.submissionRate}
              qualityScore={d.qualityScore}
              lateCount={d.lateCount}
              missingCount={d.missingCount}
              trend={d.trend}
            />
          ))}
        </div>
      )}
    </div>
  );
}
