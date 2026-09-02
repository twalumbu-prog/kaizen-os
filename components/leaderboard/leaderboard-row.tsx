import { ArrowDown, ArrowUp, Medal, Minus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const RANK_MEDAL: Record<number, string> = {
  1: "text-amber-500",
  2: "text-zinc-400",
  3: "text-amber-700",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

export interface LeaderboardStanding {
  userId: string;
  name: string;
  rank: number;
  points: number;
  maxPoints: number;
  onTime: number;
  late: number;
  missing: number;
  dueCount: number;
  /** Only present on the weekly view. */
  rankChange?: number | null;
}

export function LeaderboardRow({
  standing,
  showRankChange,
}: {
  standing: LeaderboardStanding;
  showRankChange?: boolean;
}) {
  const percent =
    standing.maxPoints === 0 ? null : Math.round((standing.points / standing.maxPoints) * 100);

  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex w-8 shrink-0 items-center justify-center">
        {standing.rank <= 3 ? (
          <Medal className={cn("size-5", RANK_MEDAL[standing.rank])} />
        ) : (
          <span className="text-sm font-medium text-muted-foreground">{standing.rank}</span>
        )}
      </div>

      <Avatar size="sm">
        <AvatarFallback>{initials(standing.name)}</AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{standing.name}</div>
        <div className="text-xs text-muted-foreground">
          {standing.dueCount === 0
            ? "Nothing due"
            : `${standing.onTime} on time · ${standing.late} late · ${standing.missing} missing`}
        </div>
      </div>

      {showRankChange && (
        <RankChangeBadge rankChange={standing.rankChange} />
      )}

      <div className="text-right">
        <div className="font-semibold tabular-nums">{standing.points} pts</div>
        {percent !== null && (
          <div className="text-xs text-muted-foreground">{percent}%</div>
        )}
      </div>
    </div>
  );
}

function RankChangeBadge({ rankChange }: { rankChange: number | null | undefined }) {
  if (rankChange === null || rankChange === undefined) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        New
      </Badge>
    );
  }
  if (rankChange === 0) {
    return (
      <Badge variant="outline" className="gap-1 text-muted-foreground">
        <Minus className="size-3" />
      </Badge>
    );
  }
  if (rankChange > 0) {
    return (
      <Badge variant="outline" className="gap-1 text-emerald-600 dark:text-emerald-400">
        <ArrowUp className="size-3" />
        {rankChange}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 text-red-600 dark:text-red-400">
      <ArrowDown className="size-3" />
      {Math.abs(rankChange)}
    </Badge>
  );
}
