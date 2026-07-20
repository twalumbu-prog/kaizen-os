export type Cadence = "daily" | "weekly" | "monthly";

/** Every period's due date is `periodEnd + 1 day` at this hour, regardless of cadence. */
const DUE_HOUR_UTC = 17;

export interface PeriodBounds {
  periodLabel: string;
  /** Inclusive start of the period, ms since epoch. */
  periodStart: number;
  /** Inclusive end of the period (23:59:59.999 of the last day), ms since epoch. */
  periodEnd: number;
  dueAt: number;
}

function startOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function endOfUTCDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/**
 * Weekly periods run Friday–Thursday (not the calendar Mon–Sun week). This
 * makes `dueAt = periodEnd + 1 day` land on Friday, matching the business's
 * "due every Friday" expectation while still being a plain T+1 rule with no
 * cadence-specific due-date logic — a Mon–Sun week with a Friday due date
 * would ask for Fri–Sun's transactions before Sunday has happened.
 */
function weekStart(date: Date): Date {
  const d = startOfUTCDay(date);
  const day = d.getUTCDay(); // 0 = Sunday .. 6 = Saturday
  const diff = (day - 5 + 7) % 7; // days since the most recent Friday
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

function periodStartFor(cadence: Cadence, date: Date): Date {
  if (cadence === "daily") return startOfUTCDay(date);
  if (cadence === "weekly") return weekStart(date);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function boundsFromStart(cadence: Cadence, start: Date): PeriodBounds {
  let end: Date;
  let periodLabel: string;

  if (cadence === "daily") {
    end = endOfUTCDay(start);
    periodLabel = start.toISOString().slice(0, 10);
  } else if (cadence === "weekly") {
    const endDay = new Date(start);
    endDay.setUTCDate(endDay.getUTCDate() + 6); // Fri..Thu inclusive
    end = endOfUTCDay(endDay);
    periodLabel = `Week of ${start.toISOString().slice(0, 10)}`;
  } else {
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    end = endOfUTCDay(lastDay);
    periodLabel = start.toISOString().slice(0, 7);
  }

  const due = new Date(end);
  due.setUTCDate(due.getUTCDate() + 1);
  due.setUTCHours(DUE_HOUR_UTC, 0, 0, 0);

  return { periodLabel, periodStart: start.getTime(), periodEnd: end.getTime(), dueAt: due.getTime() };
}

/** The period containing `now` (defaults to the current time). */
export function currentPeriod(cadence: Cadence, now: Date = new Date()): PeriodBounds {
  return boundsFromStart(cadence, periodStartFor(cadence, now));
}

/** The period containing an arbitrary past (or future) timestamp. */
export function periodContaining(cadence: Cadence, timestamp: number): PeriodBounds {
  return boundsFromStart(cadence, periodStartFor(cadence, new Date(timestamp)));
}

/** The period immediately following `bounds`. */
export function nextPeriod(cadence: Cadence, bounds: PeriodBounds): PeriodBounds {
  const nextStart = new Date(bounds.periodEnd);
  nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  nextStart.setUTCHours(0, 0, 0, 0);
  return boundsFromStart(cadence, nextStart);
}
