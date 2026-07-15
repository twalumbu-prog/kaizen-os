export const STATUS_COLOR_CLASSES: Record<
  string,
  { badge: string; dot: string; stroke: string }
> = {
  green: {
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    dot: "bg-emerald-500",
    stroke: "#10b981",
  },
  blue: {
    badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
    dot: "bg-blue-500",
    stroke: "#3b82f6",
  },
  yellow: {
    badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    dot: "bg-amber-500",
    stroke: "#f59e0b",
  },
  orange: {
    badge: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
    dot: "bg-orange-500",
    stroke: "#f97316",
  },
  red: {
    badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
    dot: "bg-red-500",
    stroke: "#ef4444",
  },
};
