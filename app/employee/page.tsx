"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarStrip } from "@/components/employee/calendar-strip";
import { FullCalendarDialog } from "@/components/employee/full-calendar-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function todayMidnightUTC(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

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

function ReportsTab() {
  const router = useRouter();
  const [selectedDate, setSelectedDate] = useState(todayMidnightUTC);
  const [showFullCalendar, setShowFullCalendar] = useState(false);

  // Strip shows a fixed recent window and scrolls natively; the full calendar
  // dialog is how you jump further away. The selected day is fetched on its
  // own so To Do/Done stay correct even for a date outside the strip's window.
  const strip = useQuery(api.submissions.myCalendar, {});
  const selectedDayCalendar = useQuery(api.submissions.myCalendar, {
    from: selectedDate,
    to: selectedDate,
  });

  if (strip === undefined || selectedDayCalendar === undefined) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const items = selectedDayCalendar[0]?.items ?? [];
  const todoItems = items.filter((item) => !item.completed);
  const doneItems = items.filter((item) => item.completed);

  function goToUpload(item: (typeof items)[number]) {
    router.push(`/employee/reports/${item.templateId}?due=${item.dueAt}`);
  }

  function goToSubmission(item: (typeof items)[number]) {
    if (item.submissionId) router.push(`/submissions/${item.submissionId}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Calendar</CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowFullCalendar(true)}>
            <CalendarDays className="size-4" />
            Show full calendar
          </Button>
        </CardHeader>
        <CardContent>
          <CalendarStrip days={strip} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
          <FullCalendarDialog
            open={showFullCalendar}
            onOpenChange={setShowFullCalendar}
            onSelectDate={setSelectedDate}
            initialDate={selectedDate}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">To Do</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {todoItems.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing to do on this date.</p>
          ) : (
            todoItems.map((item) => (
              <div key={item.templateId} className="flex items-center gap-3 py-3">
                <Circle className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">{item.templateName}</div>
                  <div className="text-xs text-muted-foreground">{item.periodLabel}</div>
                </div>
                <Button size="sm" onClick={() => goToUpload(item)}>
                  Submit
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Done</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {doneItems.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Nothing submitted on this date yet.</p>
          ) : (
            doneItems.map((item) => (
              <button
                key={item.templateId}
                type="button"
                onClick={() => goToSubmission(item)}
                className="flex items-center gap-3 py-3 text-left hover:opacity-80"
              >
                <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                <div className="flex-1">
                  <div className="font-medium">{item.templateName}</div>
                  <div className="text-xs text-muted-foreground">{item.periodLabel}</div>
                </div>
                <span className="text-xs capitalize text-muted-foreground">{item.status}</span>
              </button>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployeePortalPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Employee Portal</h1>

        <Tabs defaultValue="dashboard">
          <TabsList>
            <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
            <TabsTrigger value="reports">Reports</TabsTrigger>
          </TabsList>
          <TabsContent value="dashboard">
            <DashboardTab />
          </TabsContent>
          <TabsContent value="reports">
            <ReportsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
