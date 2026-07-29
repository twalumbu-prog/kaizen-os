"use client";

import React, { useLayoutEffect, useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface CalendarDay {
  date: number;
  items: { completed: boolean }[];
}

const EDGE_THRESHOLD_PX = 150;

export function CalendarStrip({
  days,
  selectedDate,
  onSelectDate,
  onNeedEarlier,
  onNeedLater,
}: {
  days: CalendarDay[];
  selectedDate: number;
  onSelectDate: (date: number) => void;
  /** Called while scrolled near the left edge — extend the window backward. */
  onNeedEarlier?: () => void;
  /** Called while scrolled near the right edge — extend the window forward. */
  onNeedLater?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevFirstDateRef = useRef<number | undefined>(days[0]?.date);
  const prevScrollWidthRef = useRef(0);
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
          setVisibleDate(parseInt(dateStr, 10));
        }
        break;
      }
    }
  };

  // When more (earlier) days are prepended, the browser keeps scrollLeft
  // fixed relative to the content start — which visually yanks the view to
  // the right. Compensate by adding back exactly the width that was
  // inserted, so the day the user was looking at stays in place.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const firstDate = days[0]?.date;
    if (
      prevFirstDateRef.current !== undefined &&
      firstDate !== undefined &&
      firstDate < prevFirstDateRef.current
    ) {
      const widthAdded = container.scrollWidth - prevScrollWidthRef.current;
      if (widthAdded > 0) container.scrollLeft += widthAdded;
    }
    prevFirstDateRef.current = firstDate;
    prevScrollWidthRef.current = container.scrollWidth;
    updateVisibleDate();
  }, [days]);

  useEffect(() => {
    updateVisibleDate();
  }, []);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
    
    updateVisibleDate();

    if (container.scrollLeft < EDGE_THRESHOLD_PX) {
      onNeedEarlier?.();
    }
    const distanceFromEnd = container.scrollWidth - container.clientWidth - container.scrollLeft;
    if (distanceFromEnd < EDGE_THRESHOLD_PX) {
      onNeedLater?.();
    }
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
      <div ref={containerRef} onScroll={handleScroll} className="flex gap-2 overflow-x-auto pb-2 relative">
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
