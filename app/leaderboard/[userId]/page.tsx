"use client";

import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { use } from "react";
import { ArrowLeft } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Short week label for the chart's x-axis — "Week of 2026-09-04" → "Sep 4". */
function shortWeekLabel(weekLabel: string): string {
  const iso = weekLabel.replace("Week of ", "");
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return weekLabel;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export default function LeaderboardHistoryPage({
  params,
}: {
  params: Promise<{ userId: Id<"users"> }>;
}) {
  const { userId } = use(params);
  const router = useRouter();
  const data = useQuery(api.leaderboard.leaderboardUserHistory, { userId });

  const chartData = data?.history.map((w) => ({
    week: shortWeekLabel(w.weekLabel),
    points: w.points,
    fullLabel: w.weekLabel,
  }));

  return (
    <AppShell>
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()} className="mb-4 -ml-2">
            <ArrowLeft className="mr-2 size-4" />
            Back to Leaderboard
          </Button>
          <h1 className="text-2xl font-semibold tracking-tight">{data?.name ?? "Point history"}</h1>
          <p className="text-sm text-muted-foreground">
            Points by week, most recent {data?.history.length ?? "…"} weeks.
          </p>
        </div>

        {data === undefined ? (
          <Skeleton className="h-96 w-full rounded-xl" />
        ) : data === null ? (
          <p className="py-8 text-sm text-muted-foreground">
            Couldn&apos;t find this person&apos;s history.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Weekly Points</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
                    <XAxis
                      dataKey="week"
                      tick={{ fontSize: 12 }}
                      interval="preserveStartEnd"
                      tickLine={false}
                    />
                    <YAxis tick={{ fontSize: 12 }} allowDecimals={false} width={36} />
                    <Tooltip
                      formatter={(value) => [`${value} pts`, "Points"]}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel ?? ""}
                      contentStyle={{ fontSize: 12, borderRadius: 8 }}
                    />
                    <Bar dataKey="points" radius={[3, 3, 0, 0]} fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Total This Period</CardTitle>
                <span className="font-semibold tabular-nums">
                  {data.cumulativePoints} / {data.cumulativeMaxPoints} pts
                </span>
              </CardHeader>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Week by Week</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col divide-y">
                {[...data.history].reverse().map((week) => (
                  <div key={week.weekStart} className="flex items-center justify-between py-3 text-sm">
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
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
