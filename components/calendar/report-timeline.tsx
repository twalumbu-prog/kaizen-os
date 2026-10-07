"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { Fragment, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cadenceLabel } from "@/lib/cadence";
import { cn } from "@/lib/utils";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_WIDTH_PX = 34;
const REPORT_COLUMN_PX = 260;

// The axis starts this many days either side of today and grows by
// GROW_CHUNK_DAYS whenever the table is scrolled within EDGE_THRESHOLD_PX of
// an edge, so it can be scrolled indefinitely into the past or the future.
const INITIAL_DAYS_EACH_SIDE = 60;
const GROW_CHUNK_DAYS = 60;
const EDGE_THRESHOLD_PX = 800;
// The table opens with this many days of history visible before today.
const HOME_DAYS_BEFORE_TODAY = 14;
// Due dates are fetched for a window around whatever is on screen, kept well
// under the backend's MAX_CALENDAR_RANGE_DAYS (370). The centre snaps to
// multiples of DATA_STEP_DAYS so the query only changes every so often.
const DATA_STEP_DAYS = 30;
const DATA_DAYS_EACH_SIDE = 60;
// How far the Earlier / Later buttons scroll.
const PAGE_DAYS = 28;

type Timeline = FunctionReturnType<typeof api.submissions.reportTimeline>;
type DueDate = Timeline["departments"][number]["reports"][number]["due"][number];
/** Due dates seen so far, by report then by day. */
type DueCache = ReadonlyMap<string, ReadonlyMap<number, DueDate>>;

// The three header rows stack with `position: sticky`, so each one's offset is
// the sum of the rows above it. Their heights are set explicitly rather than
// left to the content, which is what makes these offsets exact.
const YEAR_ROW_PX = 26;
const MONTH_ROW_PX = 26;
const DAY_ROW_PX = 24;

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** How a due date reads at a glance. */
const STATE_STYLES: Record<string, { dot: string; label: string }> = {
  complete: { dot: "bg-emerald-500", label: "Submitted" },
  partial: { dot: "bg-amber-500", label: "Partly submitted" },
  overdue: { dot: "bg-red-500", label: "Overdue" },
  upcoming: { dot: "bg-foreground/35", label: "Due" },
  unassigned: { dot: "bg-muted-foreground/30 ring-1 ring-inset ring-border", label: "Nobody assigned" },
};

function startOfUTCDay(ms: number): number {
  const d = new Date(ms);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function snapToDataStep(ms: number): number {
  const step = DATA_STEP_DAYS * DAY_MS;
  return Math.round(ms / step) * step;
}

/**
 * Fold a freshly loaded window into the cache. Days inside the window are
 * replaced wholesale (so a due date that disappeared stays gone); days outside
 * it keep whatever was seen when they were last in view.
 */
function mergeDueDates(prev: DueCache, timeline: Timeline, from: number, to: number): DueCache {
  const next = new Map(prev);
  for (const department of timeline.departments) {
    for (const report of department.reports) {
      const days = new Map(next.get(report.templateId));
      for (const day of days.keys()) {
        if (day >= from && day <= to) days.delete(day);
      }
      for (const due of report.due) days.set(due.day, due);
      next.set(report.templateId, days);
    }
  }
  return next;
}

/** The days in the window, with the month/year runs needed for the header rows. */
function buildAxis(from: number, to: number) {
  const days: { ms: number; date: number; weekday: number; isWeekend: boolean }[] = [];
  for (let ms = from; ms <= to; ms += DAY_MS) {
    const d = new Date(ms);
    const weekday = d.getUTCDay();
    days.push({
      ms,
      date: d.getUTCDate(),
      weekday,
      isWeekend: weekday === 0 || weekday === 6,
    });
  }

  const months: { label: string; span: number }[] = [];
  const years: { label: string; span: number }[] = [];
  for (const day of days) {
    const d = new Date(day.ms);
    const monthLabel = MONTH_NAMES[d.getUTCMonth()];
    const yearLabel = String(d.getUTCFullYear());
    const lastMonth = months[months.length - 1];
    if (lastMonth && lastMonth.label === monthLabel) lastMonth.span++;
    else months.push({ label: monthLabel, span: 1 });
    const lastYear = years[years.length - 1];
    if (lastYear && lastYear.label === yearLabel) lastYear.span++;
    else years.push({ label: yearLabel, span: 1 });
  }

  return { days, months, years };
}

export function ReportTimeline({ viewSwitcher }: { viewSwitcher?: ReactNode }) {
  const router = useRouter();
  // Read the clock once, on mount: re-reading it during every render makes the
  // "today" column jump around when the component happens to re-render.
  const [today] = useState(() => startOfUTCDay(Date.now()));
  // The axis the table renders. Independent of which days have data loaded, so
  // growing it is instant and scrolling never stalls waiting on the backend.
  const [renderFrom, setRenderFrom] = useState(() => today - INITIAL_DAYS_EACH_SIDE * DAY_MS);
  const [renderTo, setRenderTo] = useState(() => today + INITIAL_DAYS_EACH_SIDE * DAY_MS);
  // The day in the middle of the table, which the data window follows.
  const [dataCenter, setDataCenter] = useState(() => snapToDataStep(today));
  const dataFrom = dataCenter - DATA_DAYS_EACH_SIDE * DAY_MS;
  const dataTo = dataCenter + DATA_DAYS_EACH_SIDE * DAY_MS;

  const timeline = useQuery(api.submissions.reportTimeline, { from: dataFrom, to: dataTo });

  // Keep the last-loaded report list on screen while the window moves, and
  // remember every due date seen so scrolling back over them shows no gaps.
  const [lastTimeline, setLastTimeline] = useState(timeline);
  const [dueCache, setDueCache] = useState<DueCache>(new Map());
  if (timeline !== undefined && timeline !== lastTimeline) {
    setLastTimeline(timeline);
    setDueCache((prev) => mergeDueDates(prev, timeline, dataFrom, dataTo));
  }
  const shown = timeline ?? lastTimeline;

  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

  function toggleDepartment(departmentId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(departmentId)) next.delete(departmentId);
      else next.add(departmentId);
      return next;
    });
  }

  const axis = useMemo(() => buildAxis(renderFrom, renderTo), [renderFrom, renderTo]);

  const totalWidth = REPORT_COLUMN_PX + axis.days.length * DAY_WIDTH_PX;

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevRenderFromRef = useRef(renderFrom);
  const hasHomedRef = useRef(false);
  const hasTable = shown !== undefined && shown.departments.length > 0;

  /** Scroll position that puts the "home" day just after the sticky column. */
  function homeScrollLeft(): number {
    return ((today - HOME_DAYS_BEFORE_TODAY * DAY_MS - renderFrom) / DAY_MS) * DAY_WIDTH_PX;
  }

  /** Move the data window to follow the scroll, and extend the axis near an edge. */
  function syncToScroll(container: HTMLDivElement) {
    const centreIndex = Math.floor(
      (container.scrollLeft + (container.clientWidth - REPORT_COLUMN_PX) / 2) / DAY_WIDTH_PX,
    );
    setDataCenter(snapToDataStep(renderFrom + centreIndex * DAY_MS));

    if (container.scrollLeft < EDGE_THRESHOLD_PX) {
      setRenderFrom((prev) => prev - GROW_CHUNK_DAYS * DAY_MS);
    }
    const distanceFromEnd = container.scrollWidth - container.clientWidth - container.scrollLeft;
    if (distanceFromEnd < EDGE_THRESHOLD_PX) {
      setRenderTo((prev) => prev + GROW_CHUNK_DAYS * DAY_MS);
    }
  }

  // Runs after the DOM has been updated, before paint. Opens at "home" the first
  // time the table appears. After that, when days are prepended the browser
  // keeps scrollLeft fixed relative to the content start, which would yank the
  // view to the right — so move it by exactly the width that was added (every
  // column is the same fixed width) and what the user was looking at stays put.
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      hasHomedRef.current = false;
      prevRenderFromRef.current = renderFrom;
      return;
    }
    if (!hasHomedRef.current) {
      container.scrollLeft = homeScrollLeft();
      hasHomedRef.current = true;
    } else if (renderFrom < prevRenderFromRef.current) {
      container.scrollLeft +=
        ((prevRenderFromRef.current - renderFrom) / DAY_MS) * DAY_WIDTH_PX;
    }
    prevRenderFromRef.current = renderFrom;
    // Also covers a table too narrow to scroll at all (no scroll event fires).
    syncToScroll(container);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderFrom, renderTo, hasTable]);

  function scrollByDays(days: number) {
    scrollRef.current?.scrollBy({ left: days * DAY_WIDTH_PX, behavior: "smooth" });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">Timeline</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Earlier"
            onClick={() => scrollByDays(-PAGE_DAYS)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              scrollRef.current?.scrollTo({ left: homeScrollLeft(), behavior: "smooth" })
            }
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Later"
            onClick={() => scrollByDays(PAGE_DAYS)}
          >
            <ChevronRight className="size-4" />
          </Button>
          {viewSwitcher}
        </div>
      </CardHeader>
      <CardContent>
        {shown === undefined ? (
          <Skeleton className="h-80 w-full rounded-lg" />
        ) : shown.departments.length === 0 ? (
          <p className="py-6 text-sm text-muted-foreground">
            No reports to show yet. Create reports under Settings, then assign them to people.
          </p>
        ) : (
          <>
            {/* overflow-anchor is off because the browser's own scroll anchoring
                would fight the manual compensation above when days are prepended. */}
            <div
              ref={scrollRef}
              onScroll={(e) => syncToScroll(e.currentTarget)}
              className="max-h-[70vh] overflow-auto rounded-lg border [overflow-anchor:none]"
            >
              <table
                className="border-separate border-spacing-0 text-sm"
                style={{ width: totalWidth }}
              >
                <thead>
                  {/* Year */}
                  <tr>
                    <th
                      scope="col"
                      className="sticky left-0 top-0 z-30 border-b border-r bg-card p-2 text-left text-xs font-medium text-muted-foreground"
                      style={{ width: REPORT_COLUMN_PX, minWidth: REPORT_COLUMN_PX }}
                      rowSpan={3}
                    >
                      Report
                    </th>
                    {axis.years.map((year, i) => (
                      <th
                        key={`${year.label}-${i}`}
                        colSpan={year.span}
                        className="sticky top-0 z-20 border-b border-r bg-card px-2 text-left text-xs font-semibold"
                        style={{ height: YEAR_ROW_PX }}
                      >
                        {year.label}
                      </th>
                    ))}
                  </tr>
                  {/* Month */}
                  <tr>
                    {axis.months.map((month, i) => (
                      <th
                        key={`${month.label}-${i}`}
                        colSpan={month.span}
                        className="sticky z-20 border-b border-r bg-card px-2 text-left text-xs font-medium text-muted-foreground"
                        style={{ top: YEAR_ROW_PX, height: MONTH_ROW_PX }}
                      >
                        {month.label}
                      </th>
                    ))}
                  </tr>
                  {/* Day */}
                  <tr>
                    {axis.days.map((day) => (
                      <th
                        key={day.ms}
                        scope="col"
                        className={cn(
                          "sticky z-20 border-b bg-card p-0 text-center text-[11px] font-normal tabular-nums",
                          day.isWeekend ? "text-muted-foreground/50" : "text-muted-foreground",
                        )}
                        style={{
                          top: YEAR_ROW_PX + MONTH_ROW_PX,
                          height: DAY_ROW_PX,
                          width: DAY_WIDTH_PX,
                          minWidth: DAY_WIDTH_PX,
                        }}
                      >
                        {day.ms === today ? (
                          <span className="mx-auto flex size-5 items-center justify-center rounded-full bg-red-500 font-semibold text-white">
                            {day.date}
                          </span>
                        ) : (
                          day.date
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {shown.departments.map((department) => {
                    const isCollapsed = collapsed.has(department.departmentId);

                    return (
                    <Fragment key={department.departmentId}>
                      <tr>
                        <th
                          scope="rowgroup"
                          className="sticky left-0 z-10 border-b border-r bg-muted/60 p-0 text-left"
                          style={{ width: REPORT_COLUMN_PX, minWidth: REPORT_COLUMN_PX }}
                        >
                          <button
                            type="button"
                            aria-expanded={!isCollapsed}
                            onClick={() => toggleDepartment(department.departmentId)}
                            className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="size-3.5 shrink-0" />
                            ) : (
                              <ChevronDown className="size-3.5 shrink-0" />
                            )}
                            <span className="truncate">{department.departmentName}</span>
                            <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
                              ({department.reports.length})
                            </span>
                          </button>
                        </th>

                        <td
                          colSpan={axis.days.length}
                          className="border-b bg-muted/60"
                          aria-hidden
                        />
                      </tr>

                      {!isCollapsed &&
                       department.reports.map((report) => {
                        const byDay = dueCache.get(report.templateId);
                        return (
                          <tr key={report.templateId} className="group">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 border-b border-r bg-card px-3 py-2 text-left font-normal group-hover:bg-accent"
                              style={{ width: REPORT_COLUMN_PX, minWidth: REPORT_COLUMN_PX }}
                            >
                              <button
                                type="button"
                                className="block w-full truncate text-left hover:underline"
                                title={report.name}
                                onClick={() =>
                                  router.push(`/admin/reports/${report.templateId}`)
                                }
                              >
                                {report.name}
                              </button>
                              <span className="text-xs text-muted-foreground">
                                {cadenceLabel(report.cadence)}
                                {report.assigneeCount === 0
                                  ? " · unassigned"
                                  : ` · ${report.assigneeCount} assigned`}
                              </span>
                            </th>

                            {axis.days.map((day) => {
                              const due = byDay?.get(day.ms);
                              const style = due ? STATE_STYLES[due.state] : null;
                              return (
                                <td
                                  key={day.ms}
                                  className={cn(
                                    "border-b p-0 text-center align-middle",
                                    day.isWeekend && "bg-muted/40",
                                    day.ms === today && "bg-primary/10",
                                  )}
                                  style={{ width: DAY_WIDTH_PX, minWidth: DAY_WIDTH_PX }}
                                  title={
                                    due
                                      ? `${report.name} — ${due.periodLabel} — ${style?.label}` +
                                        (due.expected > 0
                                          ? ` (${due.submitted}/${due.expected})`
                                          : "")
                                      : undefined
                                  }
                                >
                                  {due && (
                                    <span
                                      className={cn(
                                        "mx-auto block size-2.5 rounded-full",
                                        style?.dot,
                                      )}
                                      aria-label={`${isoDay(due.day)}: ${style?.label}`}
                                    />
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              {Object.entries(STATE_STYLES).map(([state, style]) => (
                <span key={state} className="flex items-center gap-1.5">
                  <span className={cn("size-2.5 rounded-full", style.dot)} />
                  {style.label}
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
