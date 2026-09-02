"use client";

import { useQuery } from "convex/react";
import { Suspense, useState } from "react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { ReportTimeline } from "@/components/calendar/report-timeline";
import { ViewSwitcher, type CalendarView } from "@/components/calendar/view-switcher";
import { WorkCalendar } from "@/components/calendar/work-calendar";
import { Skeleton } from "@/components/ui/skeleton";

export default function WorkCalendarPage() {
  const me = useQuery(api.profiles.getMe);
  const [view, setView] = useState<CalendarView>("list");

  const overseeing = me?.role === "admin" || me?.role === "manager";
  const switcher = <ViewSwitcher value={view} onChange={setView} />;

  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Work Calendar</h1>
          <p className="text-sm text-muted-foreground">
            {overseeing
              ? "Everything owed across the organization, and who owes it."
              : "Everything due to you, day by day."}
          </p>
        </div>

        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          {view === "timeline" ? (
            <ReportTimeline viewSwitcher={switcher} />
          ) : (
            <WorkCalendar viewSwitcher={switcher} />
          )}
        </Suspense>
      </div>
    </AppShell>
  );
}
