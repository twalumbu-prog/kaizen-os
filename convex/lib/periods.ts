export type Cadence = "daily" | "weekly" | "monthly";

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day === 0 ? -6 : 1) - day; // shift back to Monday
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Current period label + due timestamp for a report's cadence, evaluated at `now`. */
export function currentPeriod(
  cadence: Cadence,
  now: Date = new Date(),
): { periodLabel: string; dueAt: number } {
  if (cadence === "daily") {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const due = new Date(start);
    due.setUTCHours(17, 0, 0, 0);
    return { periodLabel: start.toISOString().slice(0, 10), dueAt: due.getTime() };
  }

  if (cadence === "weekly") {
    const start = startOfWeek(now);
    const due = new Date(start);
    due.setUTCDate(due.getUTCDate() + 4); // Friday
    due.setUTCHours(17, 0, 0, 0);
    return { periodLabel: `Week of ${start.toISOString().slice(0, 10)}`, dueAt: due.getTime() };
  }

  // monthly
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const due = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 17, 0, 0));
  return { periodLabel: start.toISOString().slice(0, 7), dueAt: due.getTime() };
}
