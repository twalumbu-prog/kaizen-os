"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Circle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { CalendarStrip } from "@/components/employee/calendar-strip";
import { FullCalendarDialog } from "@/components/employee/full-calendar-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

const STRIP_DAYS_BEFORE = 10;
const STRIP_DAYS_AFTER = 10;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function ReportsTab() {
  const router = useRouter();
  const portal = useQuery(api.submissions.myPortal);
  const [selectedDate, setSelectedDate] = useState(todayMidnightUTC);
  const [stripCenter, setStripCenter] = useState(todayMidnightUTC);
  const [showFullCalendar, setShowFullCalendar] = useState(false);

  const stripFrom = stripCenter - STRIP_DAYS_BEFORE * 24 * 60 * 60 * 1000;
  const stripTo = stripCenter + STRIP_DAYS_AFTER * 24 * 60 * 60 * 1000;
  const calendar = useQuery(api.submissions.myCalendar, { from: stripFrom, to: stripTo });

  if (calendar === undefined || portal === undefined) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  const selectedDay = calendar.find((d) => d.date === selectedDate);

  function goToItem(item: NonNullable<typeof selectedDay>["items"][number]) {
    if (item.completed && item.submissionId) {
      router.push(`/submissions/${item.submissionId}`);
    } else {
      router.push(`/employee/reports/${item.templateId}?due=${item.dueAt}`);
    }
  }

  function selectDateAndRecenter(date: number) {
    setSelectedDate(date);
    setStripCenter(date);
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
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous week"
              onClick={() => setStripCenter((d) => d - WEEK_MS)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <div className="flex-1">
              <CalendarStrip days={calendar} selectedDate={selectedDate} onSelectDate={setSelectedDate} />
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next week"
              onClick={() => setStripCenter((d) => d + WEEK_MS)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <FullCalendarDialog
            open={showFullCalendar}
            onOpenChange={setShowFullCalendar}
            onSelectDate={selectDateAndRecenter}
            initialDate={selectedDate}
          />

          <div className="flex flex-col divide-y">
            {!selectedDay || selectedDay.items.length === 0 ? (
              <p className="py-2 text-sm text-muted-foreground">Nothing due on this date.</p>
            ) : (
              selectedDay.items.map((item) => (
                <button
                  key={item.templateId}
                  type="button"
                  onClick={() => goToItem(item)}
                  className="flex items-center gap-3 py-3 text-left hover:opacity-80"
                >
                  {item.completed ? (
                    <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                  ) : (
                    <Circle className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex-1">
                    <div className="font-medium">{item.templateName}</div>
                    <div className="text-xs text-muted-foreground">{item.periodLabel}</div>
                  </div>
                  <span className="text-xs capitalize text-muted-foreground">{item.status}</span>
                </button>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submission History</CardTitle>
        </CardHeader>
        <CardContent>
          {portal.history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven&apos;t submitted any reports yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Files</TableHead>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Score</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {portal.history.map(({ submission, templateName, fileCount }) => (
                  <TableRow key={submission._id}>
                    <TableCell>
                      <Link href={`/submissions/${submission._id}`} className="hover:underline">
                        {templateName}
                      </Link>
                    </TableCell>
                    <TableCell>{submission.periodLabel}</TableCell>
                    <TableCell className="capitalize">{submission.status}</TableCell>
                    <TableCell>{fileCount}</TableCell>
                    <TableCell>
                      {submission.submittedAt
                        ? new Date(submission.submittedAt).toLocaleString()
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {submission.finalScore !== undefined ? (
                        <StatusBadge score={submission.finalScore} />
                      ) : (
                        <span className="text-muted-foreground">Pending</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
