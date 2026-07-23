"use client";

import { useLayoutEffect, useRef } from "react";
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
  }, [days]);

  function handleScroll() {
    const container = containerRef.current;
    if (!container) return;
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

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex gap-2 overflow-x-auto pb-2">
      {days.map((day) => {
        const d = new Date(day.date);
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
          <button
            key={day.date}
            type="button"
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
        );
      })}
    </div>
  );
}
