import { statusForScore } from "@/convex/lib/scoring";
import { STATUS_COLOR_CLASSES } from "@/lib/status-colors";
import { cn } from "@/lib/utils";

export function StatusBadge({
  score,
  hasData = true,
  className,
}: {
  score: number;
  hasData?: boolean;
  className?: string;
}) {
  if (!hasData) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        No data yet
      </span>
    );
  }

  const status = statusForScore(score);
  const colors = STATUS_COLOR_CLASSES[status.color];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        colors.badge,
        className,
      )}
    >
      <span className={cn("size-1.5 rounded-full", colors.dot)} />
      {status.label}
    </span>
  );
}
