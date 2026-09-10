import { describe, expect, it } from "vitest";
import { boundsForDueAt, currentPeriod, nextPeriod, periodContaining } from "./periods";

const iso = (ms: number) => new Date(ms).toISOString();

describe("weekly periods (Friday-anchored)", () => {
  it("anchors a Wednesday to the preceding Friday, ending the following Thursday", () => {
    // Wednesday 2026-07-15
    const bounds = periodContaining("weekly", Date.parse("2026-07-15T12:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-07-10T00:00:00.000Z"); // Friday
    expect(iso(bounds.periodEnd)).toBe("2026-07-16T23:59:59.999Z"); // Thursday
    expect(bounds.periodLabel).toBe("Week of 2026-07-10");
  });

  it("treats Friday itself as the start of that week's period", () => {
    const bounds = periodContaining("weekly", Date.parse("2026-07-10T00:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-07-10T00:00:00.000Z");
  });

  it("is due Friday (T+1 from Thursday close)", () => {
    const bounds = periodContaining("weekly", Date.parse("2026-07-15T12:00:00Z"));
    const due = new Date(bounds.dueAt);
    expect(due.getUTCDay()).toBe(5); // Friday
    expect(due.toISOString().slice(0, 10)).toBe("2026-07-17");
  });
});

describe("daily periods", () => {
  it("is due the next calendar day", () => {
    const bounds = periodContaining("daily", Date.parse("2026-07-15T09:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-07-15T00:00:00.000Z");
    expect(iso(bounds.periodEnd)).toBe("2026-07-15T23:59:59.999Z");
    expect(new Date(bounds.dueAt).toISOString().slice(0, 10)).toBe("2026-07-16");
  });
});

describe("monthly periods", () => {
  it("spans the full calendar month and is due the 1st of next month", () => {
    const bounds = periodContaining("monthly", Date.parse("2026-02-10T09:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-02-01T00:00:00.000Z");
    expect(iso(bounds.periodEnd)).toBe("2026-02-28T23:59:59.999Z");
    expect(new Date(bounds.dueAt).toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("handles a leap year February", () => {
    const bounds = periodContaining("monthly", Date.parse("2028-02-10T09:00:00Z"));
    expect(iso(bounds.periodEnd)).toBe("2028-02-29T23:59:59.999Z");
  });
});

describe("nextPeriod", () => {
  it("steps a weekly period forward by exactly one week", () => {
    const week1 = periodContaining("weekly", Date.parse("2026-07-15T00:00:00Z"));
    const week2 = nextPeriod("weekly", week1);
    expect(iso(week2.periodStart)).toBe("2026-07-17T00:00:00.000Z");
    expect(week2.periodStart - week1.periodStart).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("steps a monthly period across a year boundary", () => {
    const dec = periodContaining("monthly", Date.parse("2026-12-15T00:00:00Z"));
    const jan = nextPeriod("monthly", dec);
    expect(jan.periodLabel).toBe("2027-01");
  });

  it("steps a daily period forward by exactly one day", () => {
    const day1 = periodContaining("daily", Date.parse("2026-07-15T00:00:00Z"));
    const day2 = nextPeriod("daily", day1);
    expect(day2.periodStart - day1.periodStart).toBe(24 * 60 * 60 * 1000);
  });
});

describe("currentPeriod", () => {
  it("matches periodContaining for the same timestamp", () => {
    const now = new Date("2026-07-15T12:00:00Z");
    expect(currentPeriod("weekly", now)).toEqual(periodContaining("weekly", now.getTime()));
  });
});

describe("weekday periods", () => {
  it("covers a single working day and is due the next day", () => {
    // Wednesday 2026-07-15
    const bounds = periodContaining("weekday", Date.parse("2026-07-15T09:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-07-15T00:00:00.000Z");
    expect(iso(bounds.periodEnd)).toBe("2026-07-15T23:59:59.999Z");
    expect(new Date(bounds.dueAt).toISOString().slice(0, 10)).toBe("2026-07-16");
  });

  it("makes Friday's report due Monday, skipping the weekend", () => {
    // Friday 2026-07-17
    const bounds = periodContaining("weekday", Date.parse("2026-07-17T09:00:00Z"));
    const due = new Date(bounds.dueAt);
    expect(due.getUTCDay()).toBe(1); // Monday
    expect(due.toISOString().slice(0, 10)).toBe("2026-07-20");
  });

  it("snaps a weekend timestamp back to the preceding Friday", () => {
    // Sunday 2026-07-19
    const bounds = periodContaining("weekday", Date.parse("2026-07-19T09:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-07-17T00:00:00.000Z");
  });

  it("steps Friday to Monday rather than back onto itself", () => {
    const friday = periodContaining("weekday", Date.parse("2026-07-17T09:00:00Z"));
    const next = nextPeriod("weekday", friday);
    expect(iso(next.periodStart)).toBe("2026-07-20T00:00:00.000Z");
  });

  it("never produces a weekend period across a full month of stepping", () => {
    let bounds = periodContaining("weekday", Date.parse("2026-07-01T09:00:00Z"));
    for (let i = 0; i < 22; i++) {
      const day = new Date(bounds.periodStart).getUTCDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
      bounds = nextPeriod("weekday", bounds);
    }
  });
});

describe("cycle periods", () => {
  // Three 13-week school terms anchored to the second week of January 2026,
  // separated by roughly a month of holiday.
  const terms = {
    cadence: "cycle" as const,
    cycle: {
      anchor: Date.parse("2026-01-12T00:00:00Z"),
      lengthWeeks: 13,
      gapDays: 31,
      dueWeek: 11,
      label: "Term",
    },
  };

  it("spans the active weeks only, and is labelled by position in the year", () => {
    const bounds = periodContaining(terms, Date.parse("2026-02-01T00:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-01-12T00:00:00.000Z");
    expect(iso(bounds.periodEnd)).toBe("2026-04-12T23:59:59.999Z"); // 13 weeks
    expect(bounds.periodLabel).toBe("Term 1 2026");
  });

  it("falls due inside the period, at the end of the configured week", () => {
    const bounds = periodContaining(terms, Date.parse("2026-02-01T00:00:00Z"));
    const due = new Date(bounds.dueAt);
    expect(due.toISOString().slice(0, 10)).toBe("2026-03-30"); // anchor + 11 weeks
    expect(bounds.dueAt).toBeGreaterThan(bounds.periodStart);
    expect(bounds.dueAt).toBeLessThan(bounds.periodEnd);
  });

  it("counts three terms in the year and restarts the ordinal in the next", () => {
    const second = nextPeriod(terms, periodContaining(terms, terms.cycle.anchor));
    const third = nextPeriod(terms, second);
    const fourth = nextPeriod(terms, third);
    expect(second.periodLabel).toBe("Term 2 2026");
    expect(third.periodLabel).toBe("Term 3 2026");
    expect(fourth.periodLabel).toBe("Term 1 2027");
  });

  it("treats a holiday date as belonging to the term it follows", () => {
    // 2026-04-20 is inside the break after Term 1 closes on 2026-04-12.
    const bounds = periodContaining(terms, Date.parse("2026-04-20T00:00:00Z"));
    expect(bounds.periodLabel).toBe("Term 1 2026");
  });

  it("throws a clear error when cycle settings are missing", () => {
    expect(() => periodContaining("cycle", Date.now())).toThrow(/cycle settings/i);
  });
});

describe("monthly periods with a custom due day", () => {
  it("falls due on the given day of the following month instead of the 1st", () => {
    const schedule = { cadence: "monthly" as const, dueDayOfMonth: 5 };
    const bounds = periodContaining(schedule, Date.parse("2026-07-10T00:00:00Z"));
    expect(iso(bounds.periodStart)).toBe("2026-07-01T00:00:00.000Z");
    expect(iso(bounds.periodEnd)).toBe("2026-07-31T23:59:59.999Z");
    expect(new Date(bounds.dueAt).toISOString().slice(0, 10)).toBe("2026-08-05");
  });

  it("defaults to the 1st when dueDayOfMonth is not set, unchanged from before", () => {
    const bounds = periodContaining("monthly", Date.parse("2026-07-10T00:00:00Z"));
    expect(new Date(bounds.dueAt).toISOString().slice(0, 10)).toBe("2026-08-01");
  });

  it("clamps to the following month's last day if it's shorter than the configured day", () => {
    // February (28 days in 2026) following January — dueDayOfMonth 30 doesn't exist.
    const schedule = { cadence: "monthly" as const, dueDayOfMonth: 30 };
    const bounds = periodContaining(schedule, Date.parse("2026-01-10T00:00:00Z"));
    expect(new Date(bounds.dueAt).toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("steps forward correctly across months with nextPeriod", () => {
    const schedule = { cadence: "monthly" as const, dueDayOfMonth: 5 };
    const jan = periodContaining(schedule, Date.parse("2026-01-15T00:00:00Z"));
    const feb = nextPeriod(schedule, jan);
    expect(iso(feb.periodStart)).toBe("2026-02-01T00:00:00.000Z");
    expect(new Date(feb.dueAt).toISOString().slice(0, 10)).toBe("2026-03-05");
  });
});

describe("boundsForDueAt", () => {
  it("recovers a default monthly period (due the 1st) from its due date", () => {
    // August (due 1 September) — the case this always worked for.
    const bounds = boundsForDueAt("monthly", Date.parse("2026-09-01T00:00:00Z"));
    expect(bounds.periodLabel).toBe("2026-08");
  });

  it("recovers a monthly period with a custom due day — regression for the day-5 statutory reports", () => {
    // August, due day 5 → due 5 September. Probing "1 day before due" (4
    // September) used to land back in September itself, not August, because
    // it fell into the calendar month *after* the origin period.
    const schedule = { cadence: "monthly" as const, dueDayOfMonth: 5 };
    const bounds = boundsForDueAt(schedule, Date.parse("2026-09-05T00:00:00Z"));
    expect(bounds.periodLabel).toBe("2026-08");
    expect(iso(bounds.periodStart)).toBe("2026-08-01T00:00:00.000Z");
    expect(iso(bounds.periodEnd)).toBe("2026-08-31T23:59:59.999Z");
  });

  it("round-trips through a full year of custom due days without drifting", () => {
    const schedule = { cadence: "monthly" as const, dueDayOfMonth: 20 };
    let cursor = periodContaining(schedule, Date.parse("2026-01-15T00:00:00Z"));
    for (let i = 0; i < 12; i++) {
      const recovered = boundsForDueAt(schedule, cursor.dueAt);
      expect(recovered.periodLabel).toBe(cursor.periodLabel);
      cursor = nextPeriod(schedule, cursor);
    }
  });

  it("recovers correctly across a December → January year boundary", () => {
    const schedule = { cadence: "monthly" as const, dueDayOfMonth: 5 };
    // December, due 5 January of the following year.
    const bounds = boundsForDueAt(schedule, Date.parse("2027-01-05T00:00:00Z"));
    expect(bounds.periodLabel).toBe("2026-12");
  });

  it("still recovers a weekly period (due the 1st is a Friday)", () => {
    const original = periodContaining("weekly", Date.parse("2026-07-15T00:00:00Z"));
    const recovered = boundsForDueAt("weekly", original.dueAt);
    expect(recovered.periodLabel).toBe(original.periodLabel);
  });
});
