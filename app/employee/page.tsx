"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WorkCalendar } from "@/components/calendar/work-calendar";
import { ScoreTab } from "@/components/employee/score-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function DashboardTab() {
  const portal = useQuery(api.submissions.myPortal);

  if (portal === undefined) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
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
  );
}

import { Suspense } from "react";

function EmployeePortalContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab") ?? "dashboard";
  const [showChart, setShowChart] = useState(false);

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Employee Portal</h1>

        <Tabs value={tab} onValueChange={(v) => router.push(`/employee?tab=${v}`)}>
          <div className="flex items-center justify-between">
            <TabsList>
              <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
              <TabsTrigger value="reports">Reports</TabsTrigger>
              <TabsTrigger value="score">Score</TabsTrigger>
            </TabsList>
            {tab === "score" && (
              <Button variant="outline" size="sm" onClick={() => setShowChart(!showChart)}>
                {showChart ? "Hide Chart" : "Show Chart"}
              </Button>
            )}
          </div>
          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="reports">
            <WorkCalendar />
          </TabsContent>
          <TabsContent value="score">
            <ScoreTab showChart={showChart} />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

export default function EmployeePortalPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
      <EmployeePortalContent />
    </Suspense>
  );
}
