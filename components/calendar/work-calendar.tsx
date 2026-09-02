"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarStrip } from "@/components/employee/calendar-strip";
import { FullCalendarDialog } from "@/components/employee/full-calendar-dialog";

function todayMidnightUTC(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;
const INITIAL_DAYS_BEFORE = 10;
const INITIAL_DAYS_AFTER = 10;
const GROW_CHUNK_DAYS = 14;
// Keep comfortably under the backend's MAX_CALENDAR_RANGE_DAYS (370) so
// scrolling never hits the query's own error.
const MAX_WINDOW_DAYS_EACH_SIDE = 175;

/**
 * The signed-in user's work calendar: a scrollable day strip plus the to-do and
 * done lists for the selected day. Admins and managers see everyone they
 * oversee here, one row per person responsible, which the backend marks with
 * `assigneeName` — those rows are read-only, since you cannot submit a report
 * on somebody else's behalf.
 */
export function WorkCalendar({ viewSwitcher }: { viewSwitcher?: ReactNode }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlDate = searchParams.get("date");

  const initialDate = urlDate ? parseInt(urlDate, 10) : todayMidnightUTC();
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [showFullCalendar, setShowFullCalendar] = useState(false);
  const today = todayMidnightUTC();
  const [windowFrom, setWindowFrom] = useState(selectedDate - INITIAL_DAYS_BEFORE * DAY_MS);
  const [windowTo, setWindowTo] = useState(selectedDate + INITIAL_DAYS_AFTER * DAY_MS);

  // Follow ?date= when it changes, by adjusting state during render rather than
  // in an effect — React's documented way to derive state from changed input.
  const [lastUrlDate, setLastUrlDate] = useState(urlDate);
  if (urlDate !== lastUrlDate) {
    setLastUrlDate(urlDate);
    if (urlDate) {
      const d = parseInt(urlDate, 10);
      setSelectedDate(d);
      setWindowFrom(d - INITIAL_DAYS_BEFORE * DAY_MS);
      setWindowTo(d + INITIAL_DAYS_AFTER * DAY_MS);
    }
  }

  // The strip's window only ever grows (never shrinks) as the user scrolls near
  // either edge — see CalendarStrip's onNeedEarlier/onNeedLater. The full
  // calendar dialog remains the fast path for jumping far away.
  const strip = useQuery(api.submissions.myCalendar, { from: windowFrom, to: windowTo });
  const selectedDayCalendar = useQuery(api.submissions.myCalendar, {
    from: selectedDate,
    to: selectedDate,
  });

  // Keep showing the last-known data while a wider range loads, so growing the
  // window doesn't flash the whole view back to a loading skeleton.
  const [lastStrip, setLastStrip] = useState(strip);
  if (strip !== undefined && strip !== lastStrip) setLastStrip(strip);
  const displayStrip = strip ?? lastStrip;

  const [lastSelected, setLastSelected] = useState(selectedDayCalendar);
  if (selectedDayCalendar !== undefined && selectedDayCalendar !== lastSelected) {
    setLastSelected(selectedDayCalendar);
  }
  const displaySelectedCalendar = selectedDayCalendar ?? lastSelected;

  if (displayStrip === undefined || displaySelectedCalendar === undefined) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  function needEarlier() {
    setWindowFrom((prev) =>
      Math.max(prev - GROW_CHUNK_DAYS * DAY_MS, today - MAX_WINDOW_DAYS_EACH_SIDE * DAY_MS),
    );
  }

  function needLater() {
    setWindowTo((prev) =>
      Math.min(prev + GROW_CHUNK_DAYS * DAY_MS, today + MAX_WINDOW_DAYS_EACH_SIDE * DAY_MS),
    );
  }

  const items = displaySelectedCalendar[0]?.items ?? [];
  const todoItems = items.filter((item) => !item.completed);
  const doneItems = items.filter((item) => item.completed);

  function goToUpload(item: (typeof items)[number]) {
    router.push(`/employee/reports/${item.templateId}?due=${item.dueAt}`);
  }

  function goToSubmission(item: (typeof items)[number]) {
    if (item.submissionId) router.push(`/submissions/${item.submissionId}`);
  }

  /** The person a row belongs to, when it is not the viewer's own. */
  function ownerLine(item: (typeof items)[number]): string {
    if (item.unassigned) return `${item.periodLabel} · nobody assigned`;
    if (item.assigneeName) return `${item.periodLabel} · ${item.assigneeName}`;
    return item.periodLabel;
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base">Calendar</CardTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowFullCalendar(true)}>
              <CalendarDays className="size-4" />
              Show full calendar
            </Button>
            {viewSwitcher}
          </div>
        </CardHeader>
        <CardContent>
          <CalendarStrip
            days={displayStrip}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onNeedEarlier={needEarlier}
            onNeedLater={needLater}
          />
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
            todoItems.map((item, index) => (
              <div
                key={`${item.templateId}-${item.assigneeName ?? "me"}-${index}`}
                className="flex items-center gap-3 py-3"
              >
                <Circle className="size-5 shrink-0 text-muted-foreground" />
                <div className="flex-1">
                  <div className="font-medium">{item.templateName}</div>
                  <div className="text-xs text-muted-foreground">{ownerLine(item)}</div>
                </div>
                {item.assigneeName || item.unassigned ? (
                  <span className="text-xs capitalize text-muted-foreground">
                    {item.unassigned ? "Unassigned" : item.status}
                  </span>
                ) : (
                  <Button size="sm" onClick={() => goToUpload(item)}>
                    Submit
                  </Button>
                )}
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
            <p className="py-2 text-sm text-muted-foreground">
              Nothing submitted on this date yet.
            </p>
          ) : (
            doneItems.map((item, index) => (
              <button
                key={`${item.templateId}-${item.assigneeName ?? "me"}-${index}`}
                type="button"
                onClick={() => goToSubmission(item)}
                className="flex items-center gap-3 py-3 text-left hover:opacity-80"
              >
                <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                <div className="flex-1">
                  <div className="font-medium">{item.templateName}</div>
                  <div className="text-xs text-muted-foreground">{ownerLine(item)}</div>
                  {item.score !== null && item.score !== undefined && (
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="text-xs font-medium text-muted-foreground">
                        Score: {item.score}%
                      </span>
                      <span
                        className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded-sm ${
                          item.score >= 80
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : "bg-red-500/10 text-red-600 dark:text-red-400"
                        }`}
                      >
                        {item.score >= 80 ? "Good" : "Poor"}
                      </span>
                    </div>
                  )}
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
