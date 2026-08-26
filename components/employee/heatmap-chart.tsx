"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { Tooltip } from "@base-ui/react/tooltip";

type PeriodScore = {
  dueAt: number;
  earned: number;
  possible: number;
  status: string;
};

type ReportScore = {
  templateName: string;
  periods: PeriodScore[];
};

export function HeatmapChart({ scores }: { scores: ReportScore[] }) {
  // Generate the last 365 days
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const days = useMemo(() => {
    const arr = [];
    const msInDay = 24 * 60 * 60 * 1000;
    
    // Find the starting Sunday to align the grid properly
    // 52 weeks * 7 days = 364 days.
    const start = new Date(today.getTime() - 364 * msInDay);
    start.setDate(start.getDate() - start.getDay()); // Align to Sunday

    let current = start.getTime();
    while (current <= today.getTime()) {
      arr.push(new Date(current));
      current += msInDay;
    }
    return arr;
  }, [today]);

  const scoresByDay = useMemo(() => {
    const map = new Map<string, { earned: number; possible: number; count: number; breakdown: string[] }>();
    
    scores.forEach((report) => {
      report.periods.forEach((p) => {
        const d = new Date(p.dueAt);
        d.setHours(0, 0, 0, 0);
        const key = d.getTime().toString();
        
        if (!map.has(key)) {
          map.set(key, { earned: 0, possible: 0, count: 0, breakdown: [] });
        }
        const val = map.get(key)!;
        val.count++;
        val.earned += p.earned;
        val.possible += p.possible;
        val.breakdown.push(`- ${report.templateName}: ${p.earned}/${p.possible}`);
      });
    });
    return map;
  }, [scores]);

  // Group into weeks
  const weeks: Date[][] = [];
  let currentWeek: Date[] = [];
  
  days.forEach((day) => {
    currentWeek.push(day);
    if (day.getDay() === 6) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });
  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  function getColor(day: Date) {
    const key = day.getTime().toString();
    const data = scoresByDay.get(key);
    
    if (!data || data.possible === 0) return "bg-muted dark:bg-muted/50"; // No reports or no score possible
    
    const pct = data.earned / data.possible;
    
    if (pct >= 0.8) return "bg-emerald-500 dark:bg-emerald-600"; // Good
    if (pct >= 0.5) return "bg-amber-400 dark:bg-amber-500"; // Average
    return "bg-red-500 dark:bg-red-600"; // Bad
  }

  function getTooltipContent(day: Date) {
    const key = day.getTime().toString();
    const data = scoresByDay.get(key);
    const dateStr = day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    
    if (!data) return `No reports due on ${dateStr}`;
    if (data.possible === 0) return `Reports due, but pending score on ${dateStr}`;
    
    const pct = Math.round((data.earned / data.possible) * 100);
    return `${pct}% score on ${dateStr} (${data.count} report${data.count === 1 ? "" : "s"})\n\nBreakdown:\n${data.breakdown.join("\n")}`;
  }

  return (
    <div className="flex flex-col gap-4 overflow-x-auto pb-4">
      <div className="flex min-w-max gap-1">
        {/* Y-axis labels */}
        <div className="flex flex-col gap-1 pr-1 text-[10px] leading-[12px] text-muted-foreground">
          <div className="h-3 flex items-center">Sun</div>
          <div className="h-3 flex items-center">Mon</div>
          <div className="h-3 flex items-center">Tue</div>
          <div className="h-3 flex items-center">Wed</div>
          <div className="h-3 flex items-center">Thu</div>
          <div className="h-3 flex items-center">Fri</div>
          <div className="h-3 flex items-center">Sat</div>
        </div>
        
        {/* Calendar Grid */}
        <Tooltip.Provider delay={200}>
          {weeks.map((week, i) => (
            <div key={i} className="flex flex-col gap-1">
              {week.map((day) => (
                <Tooltip.Root key={day.getTime()}>
                  <Tooltip.Trigger
                    render={
                      <div
                        className={cn(
                          "h-3 w-3 rounded-[2px] transition-colors hover:ring-1 hover:ring-foreground",
                          getColor(day)
                        )}
                      />
                    }
                  />
                  <Tooltip.Portal>
                    <Tooltip.Positioner side="top" align="center" sideOffset={8}>
                      <Tooltip.Popup className="z-50 max-w-xs pointer-events-none whitespace-pre-wrap rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background shadow-md">
                        {getTooltipContent(day)}
                      </Tooltip.Popup>
                    </Tooltip.Positioner>
                  </Tooltip.Portal>
                </Tooltip.Root>
              ))}
            </div>
          ))}
        </Tooltip.Provider>
      </div>

      <div className="border-t border-border pt-4">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>Less</span>
          <div className="flex gap-1">
            <div className="h-3 w-3 rounded-[2px] bg-muted dark:bg-muted/50" />
            <div className="h-3 w-3 rounded-[2px] bg-red-500 dark:bg-red-600" />
            <div className="h-3 w-3 rounded-[2px] bg-amber-400 dark:bg-amber-500" />
            <div className="h-3 w-3 rounded-[2px] bg-emerald-500 dark:bg-emerald-600" />
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
