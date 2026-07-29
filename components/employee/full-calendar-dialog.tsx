"use client";

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function monthGridRange(year: number, month: number) {
  const firstOfMonth = new Date(Date.UTC(year, month, 1));
  const gridStart = new Date(firstOfMonth);
  gridStart.setUTCDate(gridStart.getUTCDate() - firstOfMonth.getUTCDay());

  const lastOfMonth = new Date(Date.UTC(year, month + 1, 0));
  const gridEnd = new Date(lastOfMonth);
  gridEnd.setUTCDate(gridEnd.getUTCDate() + (6 - lastOfMonth.getUTCDay()));

  return { gridStart, gridEnd };
}

export function FullCalendarDialog({
  open,
  onOpenChange,
  onSelectDate,
  initialDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectDate: (date: number) => void;
  initialDate: number;
}) {
  const initial = new Date(initialDate);
  const [viewYear, setViewYear] = useState(initial.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(initial.getUTCMonth());

  const { gridStart, gridEnd } = useMemo(
    () => monthGridRange(viewYear, viewMonth),
    [viewYear, viewMonth],
  );

  const calendar = useQuery(
    api.submissions.myCalendar,
    open ? { from: gridStart.getTime(), to: gridEnd.getTime() } : "skip",
  );

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  function goToMonth(delta: number) {
    const next = new Date(Date.UTC(viewYear, viewMonth + delta, 1));
    setViewYear(next.getUTCFullYear());
    setViewMonth(next.getUTCMonth());
  }

  const monthLabel = new Date(Date.UTC(viewYear, viewMonth, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pt-8">
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => goToMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <DialogTitle>{monthLabel}</DialogTitle>
            <Button variant="ghost" size="icon" onClick={() => goToMonth(1)} aria-label="Next month">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {calendar === undefined
            ? Array.from({ length: 42 }).map((_, i) => <div key={i} className="aspect-square" />)
            : calendar.map((day) => {
                const d = new Date(day.date);
                const inMonth = d.getUTCMonth() === viewMonth;
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
                const isToday = day.date === todayMs;

                return (
                  <button
                    key={day.date}
                    type="button"
                    disabled={!inMonth}
                    onClick={() => {
                      onSelectDate(day.date);
                      onOpenChange(false);
                    }}
                    className={cn(
                      "flex aspect-square flex-col items-center justify-center gap-1 rounded-md text-sm transition-colors",
                      !inMonth && "text-muted-foreground/30",
                      inMonth && "hover:bg-accent",
                      isToday && "ring-1 ring-primary",
                    )}
                  >
                    <span>{d.getUTCDate()}</span>
                    <span className={cn("size-1.5 rounded-full", dotColor)} />
                  </button>
                );
              })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
