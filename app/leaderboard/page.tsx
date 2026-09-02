"use client";

import { useQuery } from "convex/react";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Trophy } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeaderboardRow } from "@/components/leaderboard/leaderboard-row";

function EmptyState() {
  return (
    <p className="py-8 text-center text-sm text-muted-foreground">
      Nobody has an assigned report yet. Assign reports to people under Settings to start the
      leaderboard.
    </p>
  );
}

function CumulativeBoard() {
  const data = useQuery(api.leaderboard.leaderboardTotals, {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">All-Time Points</CardTitle>
      </CardHeader>
      <CardContent>
        {data === undefined ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : data.standings.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col divide-y">
            {data.standings.map((standing) => (
              <LeaderboardRow key={standing.userId} standing={standing} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WeeklyBoard() {
  // undefined = "this week"; the server always normalizes to the Friday-anchored
  // week containing whatever timestamp it's given.
  const [weekStart, setWeekStart] = useState<number | undefined>(undefined);
  const data = useQuery(api.leaderboard.leaderboardWeek, { weekStart });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">{data?.weekLabel ?? "Weekly Points"}</CardTitle>
          {data?.isCurrentWeek && (
            <p className="text-xs text-muted-foreground">Current week, still in progress</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            aria-label="Previous week"
            disabled={data === undefined}
            onClick={() => setWeekStart(data?.prevWeekStart)}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(undefined)}
            disabled={data?.isCurrentWeek}
          >
            This week
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="Next week"
            disabled={data === undefined}
            onClick={() => setWeekStart(data?.nextWeekStart)}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {data === undefined ? (
          <Skeleton className="h-64 w-full rounded-lg" />
        ) : data.standings.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="flex flex-col divide-y">
            {data.standings.map((standing) => (
              <LeaderboardRow key={standing.userId} standing={standing} showRankChange />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function LeaderboardPage() {
  return (
    <AppShell>
      <div className="flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Trophy className="size-6 text-amber-500" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Points for submitting on time — full marks on time, less if late, none if missed.
            </p>
          </div>
        </div>

        <Tabs defaultValue="cumulative">
          <TabsList>
            <TabsTrigger value="cumulative">Cumulative</TabsTrigger>
            <TabsTrigger value="weekly">By Week</TabsTrigger>
          </TabsList>
          <TabsContent value="cumulative">
            <CumulativeBoard />
          </TabsContent>
          <TabsContent value="weekly">
            <WeeklyBoard />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}
