export type Cadence = "daily" | "weekday" | "weekly" | "monthly" | "cycle";

/**
 * Settings for the `cycle` cadence: a run of active weeks, then a break, then
 * the next run — repeating from `anchor`. Deliberately industry-neutral: a
 * school calls a cycle a "term", a factory might call it a production run.
 */
export interface CycleConfig {
  /** UTC ms, midnight — the first cycle's opening day. */
  anchor: number;
  /** Active weeks in each cycle (e.g. a 13-week school term). */
  lengthWeeks: number;
  /**
   * Break between one cycle closing and the next opening, in days. Days rather
   * than weeks because breaks are usually "about a month", which is not a whole
   * number of weeks — 31 keeps three 13-week cycles landing on a 366-day year.
   */
  gapDays: number;
  /** 1-based week within the cycle at whose end the report is due. */
  dueWeek: number;
  /** Word used in period labels — "Term", "Sprint", "Season". Defaults to "Cycle". */
  label?: string;
}

/** What a report's periods are driven by. A bare cadence string is also accepted. */
export interface Schedule {
  cadence: Cadence;
  cycle?: CycleConfig | null;
}

export type ScheduleInput = Cadence | Schedule;

/** Every period's due date lands at this hour. */
const DUE_HOUR_UTC = 17;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodBounds {
  periodLabel: string;
  /** Inclusive start of the period, ms since epoch. */
  periodStart: number;
  /** Inclusive end of the period (23:59:59.999 of the last day), ms since epoch. */
  periodEnd: number;
  dueAt: number;
}

function asSchedule(input: ScheduleInput): Schedule {
  return typeof input === "string" ? { cadence: input } : input;
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

function atDueHour(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(DUE_HOUR_UTC, 0, 0, 0);
  return d;
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** The most recent Monday–Friday on or before `date`. */
function snapBackToWeekday(date: Date): Date {
  const d = startOfUTCDay(date);
  while (isWeekend(d)) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** The first Monday–Friday strictly after `date`. */
function nextWeekday(date: Date): Date {
  const d = startOfUTCDay(date);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (isWeekend(d));
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

// ─── Cycle helpers ────────────────────────────────────────────────────────────

function requireCycle(schedule: Schedule): CycleConfig {
  const cycle = schedule.cycle;
  if (!cycle) {
    throw new Error(
      'A "cycle" cadence needs cycle settings (anchor, length, gap and due week) on the report.',
    );
  }
  return cycle;
}

function cycleSpanMs(cycle: CycleConfig): number {
  return (cycle.lengthWeeks * 7 + cycle.gapDays) * DAY_MS;
}

/** Which cycle a timestamp falls in. Days inside a break belong to the cycle they follow. */
function cycleIndexAt(cycle: CycleConfig, timestamp: number): number {
  return Math.floor((timestamp - cycle.anchor) / cycleSpanMs(cycle));
}

function cycleStart(cycle: CycleConfig, index: number): Date {
  return startOfUTCDay(new Date(cycle.anchor + index * cycleSpanMs(cycle)));
}

/**
 * Labels a cycle by its position within its own calendar year — "Term 1 2026",
 * "Term 2 2026" — so the label reads the way people talk about it.
 */
function cycleLabel(cycle: CycleConfig, index: number): string {
  const prefix = cycle.label?.trim() || "Cycle";
  const year = cycleStart(cycle, index).getUTCFullYear();
  let ordinal = 1;
  for (let i = index - 1; i >= index - 24; i--) {
    if (cycleStart(cycle, i).getUTCFullYear() !== year) break;
    ordinal++;
  }
  return `${prefix} ${ordinal} ${year}`;
}

function cycleBounds(cycle: CycleConfig, index: number): PeriodBounds {
  const start = cycleStart(cycle, index);

  const lastDay = new Date(start);
  lastDay.setUTCDate(lastDay.getUTCDate() + cycle.lengthWeeks * 7 - 1);

  // Unlike every other cadence, a cycle's report falls due *inside* the period
  // (a term's exam is written before the term ends), so the due date is driven
  // by dueWeek rather than by the period's close.
  const due = new Date(start);
  due.setUTCDate(due.getUTCDate() + cycle.dueWeek * 7);

  return {
    periodLabel: cycleLabel(cycle, index),
    periodStart: start.getTime(),
    periodEnd: endOfUTCDay(lastDay).getTime(),
    dueAt: atDueHour(due).getTime(),
  };
}

// ─── Period construction ──────────────────────────────────────────────────────

function periodStartFor(cadence: Cadence, date: Date): Date {
  if (cadence === "daily") return startOfUTCDay(date);
  if (cadence === "weekday") return snapBackToWeekday(date);
  if (cadence === "weekly") return weekStart(date);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function boundsFromStart(schedule: Schedule, start: Date): PeriodBounds {
  const { cadence } = schedule;

  if (cadence === "cycle") {
    const cycle = requireCycle(schedule);
    return cycleBounds(cycle, cycleIndexAt(cycle, start.getTime()));
  }

  let end: Date;
  let periodLabel: string;
  let due: Date;

  if (cadence === "daily") {
    end = endOfUTCDay(start);
    periodLabel = start.toISOString().slice(0, 10);
    due = new Date(start);
    due.setUTCDate(due.getUTCDate() + 1);
  } else if (cadence === "weekday") {
    end = endOfUTCDay(start);
    periodLabel = start.toISOString().slice(0, 10);
    // Friday's report is due Monday — the weekend is not a working day.
    due = nextWeekday(start);
  } else if (cadence === "weekly") {
    const endDay = new Date(start);
    endDay.setUTCDate(endDay.getUTCDate() + 6); // Fri..Thu inclusive
    end = endOfUTCDay(endDay);
    periodLabel = `Week of ${start.toISOString().slice(0, 10)}`;
    due = new Date(end);
    due.setUTCDate(due.getUTCDate() + 1);
  } else {
    const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    end = endOfUTCDay(lastDay);
    periodLabel = start.toISOString().slice(0, 7);
    due = new Date(end);
    due.setUTCDate(due.getUTCDate() + 1);
  }

  return {
    periodLabel,
    periodStart: start.getTime(),
    periodEnd: end.getTime(),
    dueAt: atDueHour(due).getTime(),
  };
}

/** The period containing `now` (defaults to the current time). */
export function currentPeriod(schedule: ScheduleInput, now: Date = new Date()): PeriodBounds {
  return periodContaining(schedule, now.getTime());
}

/** The period containing an arbitrary past (or future) timestamp. */
export function periodContaining(schedule: ScheduleInput, timestamp: number): PeriodBounds {
  const normalized = asSchedule(schedule);
  if (normalized.cadence === "cycle") {
    const cycle = requireCycle(normalized);
    return cycleBounds(cycle, cycleIndexAt(cycle, timestamp));
  }
  return boundsFromStart(normalized, periodStartFor(normalized.cadence, new Date(timestamp)));
}

/** The period immediately following `bounds`. */
export function nextPeriod(schedule: ScheduleInput, bounds: PeriodBounds): PeriodBounds {
  const normalized = asSchedule(schedule);
  const { cadence } = normalized;

  if (cadence === "cycle") {
    const cycle = requireCycle(normalized);
    return cycleBounds(cycle, cycleIndexAt(cycle, bounds.periodStart) + 1);
  }

  // Stepping from the period's own start (rather than its end) keeps cadences
  // whose periods do not tile the calendar — weekday skips weekends — from
  // landing back inside the period they just left.
  const start = new Date(bounds.periodStart);
  let nextStart: Date;

  if (cadence === "daily") {
    nextStart = new Date(start);
    nextStart.setUTCDate(nextStart.getUTCDate() + 1);
  } else if (cadence === "weekday") {
    nextStart = nextWeekday(start);
  } else if (cadence === "weekly") {
    nextStart = new Date(start);
    nextStart.setUTCDate(nextStart.getUTCDate() + 7);
  } else {
    nextStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  }

  return boundsFromStart(normalized, nextStart);
}
