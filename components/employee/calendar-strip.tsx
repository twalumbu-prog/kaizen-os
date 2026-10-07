"use client";

import React, { useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface CalendarDay {
  date: number;
  items: { completed: boolean }[];
}

// Start extending well before the edge so a fast fling never reaches it.
const EDGE_THRESHOLD_PX = 800;

export function CalendarStrip({
  days,
  selectedDate,
  onSelectDate,
  onNeedEarlier,
  onNeedLater,
  onVisibleDateChange,
}: {
  days: CalendarDay[];
  selectedDate: number;
  onSelectDate: (date: number) => void;
  /** Called while scrolled near the left edge — prepend earlier days to `days`. */
  onNeedEarlier?: () => void;
  /** Called while scrolled near the right edge — append later days to `days`. */
  onNeedLater?: () => void;
  /** The day at the middle of the strip, reported as the user scrolls. */
  onVisibleDateChange?: (date: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevFirstDateRef = useRef<number | undefined>(days[0]?.date);
  const prevFirstLeftRef = useRef(0);
  const [visibleDate, setVisibleDate] = useState<number | undefined>(days[0]?.date);

  const updateVisibleDate = () => {
    const container = containerRef.current;
    if (!container) return;
    const center = container.scrollLeft + container.clientWidth / 2;

    const children = container.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      if (child.offsetLeft + child.offsetWidth >= center) {
        const dateStr = child.getAttribute("data-date");
        if (dateStr) {
          const date = parseInt(dateStr, 10);
          setVisibleDate(date);
          onVisibleDateChange?.(date);
        }
        break;
      }
    }
  };

  /** Ask for more days on whichever side is running out of runway. */
  const extendIfNearEdge = () => {
    const container = containerRef.current;
    if (!container) return;
    if (container.scrollLeft < EDGE_THRESHOLD_PX) onNeedEarlier?.();
    const distanceFromEnd = container.scrollWidth - container.clientWidth - container.scrollLeft;
    if (distanceFromEnd < EDGE_THRESHOLD_PX) onNeedLater?.();
  };

  // Start with the selected day in the middle, so there is room to scroll both
  // ways. The strip is re-mounted (via `key`) whenever the date is jumped.
  useLayoutEffect(() => {
    const container = containerRef.current;
    const selected = container?.querySelector<HTMLElement>(`[data-date="${selectedDate}"]`);
    if (container && selected) {
      container.scrollLeft =
        selected.offsetLeft - (container.clientWidth - selected.offsetWidth) / 2;
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When earlier days are prepended, the browser keeps scrollLeft fixed relative
  // to the content start, which would yank the view to the right. Move
  // scrollLeft by however far the previously-first day was pushed, so what the
  // user was looking at stays put.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const firstDate = days[0]?.date;
    const prevFirstDate = prevFirstDateRef.current;
    if (prevFirstDate !== undefined && firstDate !== undefined && firstDate < prevFirstDate) {
      const prevFirst = container.querySelector<HTMLElement>(`[data-date="${prevFirstDate}"]`);
      if (prevFirst) container.scrollLeft += prevFirst.offsetLeft - prevFirstLeftRef.current;
    }
    prevFirstDateRef.current = firstDate;
    prevFirstLeftRef.current =
      container.querySelector<HTMLElement>("[data-date]")?.offsetLeft ?? 0;
    updateVisibleDate();
    // Also covers a strip that is too short to scroll at all (no scroll event).
    extendIfNearEdge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  function handleScroll() {
    updateVisibleDate();
    extendIfNearEdge();
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  const dVisible = new Date(visibleDate || days[0]?.date || Date.now());
  const monthYear = dVisible.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div className="flex flex-col gap-2">
      <div className="text-center text-sm font-medium text-muted-foreground">
        {monthYear}
      </div>
      {/* overflow-anchor is off because the browser's own scroll anchoring would
          fight the manual compensation above when days are prepended. */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex gap-2 overflow-x-auto pb-2 relative [overflow-anchor:none]"
      >
        {days.map((day, i) => {
          const d = new Date(day.date);
          const prevDay = i > 0 ? new Date(days[i - 1].date) : null;
          const isNewMonth = prevDay && d.getUTCMonth() !== prevDay.getUTCMonth();
          const isSelected = day.date === selectedDate;
          const hasItems = day.items.length > 0;
          const allDone = hasItems && day.items.every((i) => i.completed);
          const isOverdue = hasItems && !allDone && day.date < todayMs;
          const dotColor = !hasItems
            ? "bg-transparent"
            : allDone
              ? "bg-emerald-500"
              : isOverdue
                ? "bg-red-500"
                : "bg-blue-400";

          return (
            <React.Fragment key={day.date}>
              {isNewMonth && (
                <div className="w-[2px] bg-foreground/20 shrink-0 mx-2 my-2 rounded-full" />
              )}
              <button
              type="button"
              data-date={day.date}
              onClick={() => onSelectDate(day.date)}
            className={cn(
              "flex min-w-14 shrink-0 flex-col items-center gap-1 rounded-lg border px-2 py-2 text-sm transition-colors",
              isSelected ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent",
            )}
          >
            <span className={cn("text-xs", isSelected ? "text-primary-foreground/80" : "text-muted-foreground")}>
              {d.toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}
            </span>
            <span className="font-semibold">{d.getUTCDate()}</span>
            <span className={cn("size-1.5 rounded-full", dotColor)} />
          </button>
            </React.Fragment>
        );
      })}
      </div>
    </div>
  );
}
