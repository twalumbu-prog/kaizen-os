"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function EmployeePortalPage() {
  const portal = useQuery(api.submissions.myPortal);
  const assignments = useQuery(api.submissions.myAssignedTemplates);

  if (portal === undefined || assignments === undefined) {
    return (
      <AppShell>
        <Skeleton className="h-48 w-full rounded-xl" />
      </AppShell>
    );
  }

  const stats = [
    { label: "Reports Due Today", value: portal.dueToday.length },
    { label: "Upcoming Reports", value: portal.upcoming.length },
    { label: "Late Reports", value: portal.late.length },
    { label: "Completed Reports", value: portal.completed.length },
    { label: "Performance Score", value: portal.performanceScore !== null ? `${portal.performanceScore}%` : "—" },
    { label: "Current Streak", value: portal.streak },
  ];

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Employee Portal</h1>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.label}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              </CardHeader>
              <CardContent className="text-3xl font-semibold tracking-tight">{s.value}</CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Assigned Reports</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {assignments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reports assigned yet. Ask your admin to assign you.</p>
            ) : (
              assignments.map(
                ({ assignment, template }) =>
                  template && (
                    <div
                      key={assignment._id}
                      className="flex items-center justify-between rounded-md border p-3"
                    >
                      <div>
                        <div className="font-medium">{template.name}</div>
                        <Badge variant="outline" className="mt-1 capitalize">
                          {template.cadence}
                        </Badge>
                      </div>
                      <Button size="sm" render={<Link href={`/employee/reports/${template._id}`} />}>
                        Upload
                      </Button>
                    </div>
                  ),
              )
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
