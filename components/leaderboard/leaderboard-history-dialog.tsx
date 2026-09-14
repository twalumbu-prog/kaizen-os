"use client";

import { useQuery } from "convex/react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

/** Short week label for the chart's x-axis — "Week of 2026-09-04" → "Sep 4". */
function shortWeekLabel(weekLabel: string): string {
  const iso = weekLabel.replace("Week of ", "");
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return weekLabel;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function LeaderboardHistoryDialog({
  userId,
  open,
  onOpenChange,
}: {
  userId: Id<"users"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const data = useQuery(
    api.leaderboard.leaderboardUserHistory,
    userId ? { userId } : "skip",
  );

  const chartData = data?.history.map((w) => ({
    week: shortWeekLabel(w.weekLabel),
    points: w.points,
    fullLabel: w.weekLabel,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{data?.name ?? "Point history"}</DialogTitle>
          <DialogDescription>
            Points by week, most recent {data?.history.length ?? "…"} weeks.
          </DialogDescription>
        </DialogHeader>

        {data === undefined ? (
          <Skeleton className="h-72 w-full rounded-lg" />
        ) : data === null ? (
          <p className="py-6 text-sm text-muted-foreground">
            Couldn&apos;t find this person&apos;s history.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border bg-muted/20 p-3">
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <XAxis
                    dataKey="week"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                    tickLine={false}
                  />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={32} />
                  <Tooltip
                    formatter={(value) => [`${value} pts`, "Points"]}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                    contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  />
                  <Bar dataKey="points" radius={[3, 3, 0, 0]} fill="var(--primary)" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total this period</span>
              <span className="font-semibold tabular-nums">
                {data.cumulativePoints} / {data.cumulativeMaxPoints} pts
              </span>
            </div>

            <div className="flex max-h-64 flex-col divide-y overflow-y-auto">
              {[...data.history].reverse().map((week) => (
                <div key={week.weekStart} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <div className="font-medium">{week.weekLabel}</div>
                    <div className="text-xs text-muted-foreground">
                      {week.dueCount === 0
                        ? "Nothing due"
                        : `${week.onTime} on time · ${week.late} late · ${week.missing} missing`}
                    </div>
                  </div>
                  <span className="font-medium tabular-nums">{week.points} pts</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
