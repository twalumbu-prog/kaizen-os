import { describe, expect, it } from "vitest";
import { currentPeriod, nextPeriod, periodContaining } from "./periods";

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
