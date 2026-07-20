"use client";

import { cn } from "@/lib/utils";

export interface CalendarDay {
  date: number;
  items: { completed: boolean }[];
}

export function CalendarStrip({
  days,
  selectedDate,
  onSelectDate,
}: {
  days: CalendarDay[];
  selectedDate: number;
  onSelectDate: (date: number) => void;
}) {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
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
