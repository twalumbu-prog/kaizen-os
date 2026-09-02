import type { Cadence, CycleConfig } from "@/convex/lib/periods";

export type { Cadence, CycleConfig };

export const CADENCE_OPTIONS: { value: Cadence; label: string; hint: string }[] = [
  { value: "daily", label: "Daily", hint: "Every day, including weekends" },
  { value: "weekday", label: "Daily (weekdays)", hint: "Monday to Friday only" },
  { value: "weekly", label: "Weekly", hint: "Due every Friday" },
  { value: "monthly", label: "Monthly", hint: "Due the 1st of the next month" },
  { value: "cycle", label: "Per cycle", hint: "A repeating run of weeks, e.g. a school term" },
];

export function cadenceLabel(cadence: string): string {
  return CADENCE_OPTIONS.find((c) => c.value === cadence)?.label ?? cadence;
}

/** Midnight UTC on the first Monday of the current year — a neutral cycle anchor. */
function firstMondayOfThisYear(): number {
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d.getTime();
}

/**
 * Applied whenever a report is switched to the `cycle` cadence, so a cycle
 * report always has settings to compute periods from — the admin then edits
 * the numbers. A 13-week run with a month between runs is the common case.
 */
export function defaultCycleConfig(): CycleConfig {
  return {
    anchor: firstMondayOfThisYear(),
    lengthWeeks: 13,
    gapDays: 31,
    dueWeek: 11,
    label: "Cycle",
  };
}

/** yyyy-mm-dd for a `<input type="date">`, from a UTC ms timestamp. */
export function toDateInput(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** UTC midnight ms from a `<input type="date">` value. */
export function fromDateInput(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}
