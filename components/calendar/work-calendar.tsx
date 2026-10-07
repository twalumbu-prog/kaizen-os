"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { CalendarDays, CheckCircle2, Circle } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarStrip } from "@/components/employee/calendar-strip";
import { FullCalendarDialog } from "@/components/employee/full-calendar-dialog";
import { ReportOptionsMenu } from "@/components/calendar/report-options-menu";

function todayMidnightUTC(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;
// The strip renders this many days either side of the selected day to begin
// with, and grows by GROW_CHUNK_DAYS whenever it is scrolled near an edge — so
// it can be scrolled indefinitely in both directions.
const INITIAL_DAYS_EACH_SIDE = 30;
const GROW_CHUNK_DAYS = 30;
// Calendar data is fetched for a window around whatever is on screen. Kept well
// under the backend's MAX_CALENDAR_RANGE_DAYS (370). The centre snaps to
// multiples of DATA_STEP_DAYS so the query only changes every so often.
const DATA_STEP_DAYS = 30;
const DATA_DAYS_EACH_SIDE = 60;

function snapToDataStep(ms: number): number {
  const step = DATA_STEP_DAYS * DAY_MS;
  return Math.round(ms / step) * step;
}

type CalendarItems = FunctionReturnType<typeof api.submissions.myCalendar>[number]["items"];

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
  // Which days the strip renders. Independent of which days have data loaded, so
  // growing it is instant and the strip never stalls waiting on the backend.
  const [renderFrom, setRenderFrom] = useState(initialDate - INITIAL_DAYS_EACH_SIDE * DAY_MS);
  const [renderTo, setRenderTo] = useState(initialDate + INITIAL_DAYS_EACH_SIDE * DAY_MS);
  // The day in the middle of the strip, which the data window follows.
  const [dataCenter, setDataCenter] = useState(() => snapToDataStep(initialDate));
  // Bumped to re-mount the strip (and so re-centre it) when the date is jumped.
  const [stripKey, setStripKey] = useState(0);

  // Follow ?date= when it changes, by adjusting state during render rather than
  // in an effect — React's documented way to derive state from changed input.
  const [lastUrlDate, setLastUrlDate] = useState(urlDate);
  if (urlDate !== lastUrlDate) {
    setLastUrlDate(urlDate);
    if (urlDate) {
      const d = parseInt(urlDate, 10);
      setSelectedDate(d);
      setRenderFrom(d - INITIAL_DAYS_EACH_SIDE * DAY_MS);
      setRenderTo(d + INITIAL_DAYS_EACH_SIDE * DAY_MS);
      setDataCenter(snapToDataStep(d));
      setStripKey((k) => k + 1);
    }
  }

  const strip = useQuery(api.submissions.myCalendar, {
    from: dataCenter - DATA_DAYS_EACH_SIDE * DAY_MS,
    to: dataCenter + DATA_DAYS_EACH_SIDE * DAY_MS,
  });
  const selectedDayCalendar = useQuery(api.submissions.myCalendar, {
    from: selectedDate,
    to: selectedDate,
  });
  const me = useQuery(api.profiles.getMe);
  const canViewConfig = me?.role === "admin";

  // Remember every day's items from each window that has loaded, so moving the
  // data window along doesn't blank out days that were already seen. The live
  // window always overwrites what is cached for its own days.
  const [loadedDays, setLoadedDays] = useState<ReadonlyMap<number, CalendarItems>>(new Map());
  const [lastStrip, setLastStrip] = useState(strip);
  if (strip !== undefined && strip !== lastStrip) {
    setLastStrip(strip);
    setLoadedDays((prev) => {
      const next = new Map(prev);
      for (const day of strip) next.set(day.date, day.items);
      return next;
    });
  }

  // Keep showing the last-known data while a wider range loads, so growing the
  // window doesn't flash the whole view back to a loading skeleton.
  const [lastSelected, setLastSelected] = useState(selectedDayCalendar);
  if (selectedDayCalendar !== undefined && selectedDayCalendar !== lastSelected) {
    setLastSelected(selectedDayCalendar);
  }
  const displaySelectedCalendar = selectedDayCalendar ?? lastSelected;

  const stripDays = useMemo(() => {
    const out: { date: number; items: CalendarItems }[] = [];
    for (let date = renderFrom; date <= renderTo; date += DAY_MS) {
      out.push({ date, items: loadedDays.get(date) ?? [] });
    }
    return out;
  }, [renderFrom, renderTo, loadedDays]);

  if (
    (strip === undefined && loadedDays.size === 0) ||
    displaySelectedCalendar === undefined
  ) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  function needEarlier() {
    setRenderFrom((prev) => prev - GROW_CHUNK_DAYS * DAY_MS);
  }

  function needLater() {
    setRenderTo((prev) => prev + GROW_CHUNK_DAYS * DAY_MS);
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
            key={stripKey}
            days={stripDays}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onNeedEarlier={needEarlier}
            onNeedLater={needLater}
            onVisibleDateChange={(date) => setDataCenter(snapToDataStep(date))}
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
                {item.canSubmit || (!item.assigneeName && !item.unassigned) ? (
                  <Button size="sm" onClick={() => goToUpload(item)}>
                    Submit
                  </Button>
                ) : (
                  <span className="text-xs capitalize text-muted-foreground">
                    {item.unassigned ? "Unassigned" : item.status}
                  </span>
                )}
                <ReportOptionsMenu templateId={item.templateId} canViewConfig={canViewConfig} />
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
              <div
                key={`${item.templateId}-${item.assigneeName ?? "me"}-${index}`}
                className="flex items-center gap-3 py-3"
              >
                <button
                  type="button"
                  onClick={() => goToSubmission(item)}
                  className="flex flex-1 items-center gap-3 text-left hover:opacity-80"
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
                </button>
                <span className="text-xs capitalize text-muted-foreground">{item.status}</span>
                <ReportOptionsMenu templateId={item.templateId} canViewConfig={canViewConfig} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
