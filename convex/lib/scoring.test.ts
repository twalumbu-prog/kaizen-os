import { describe, expect, it } from "vitest";
import {
  statusForScore,
  submissionScore,
  qualityScoreFromChecklist,
  finalReportScore,
  departmentHealthScore,
  organizationHealthScore,
  submissionRate,
} from "./scoring";

describe("statusForScore", () => {
  it.each([
    [100, "excellent"],
    [95, "excellent"],
    [94, "good"],
    [85, "good"],
    [84, "average"],
    [70, "average"],
    [69, "poor"],
    [50, "poor"],
    [49, "critical"],
    [0, "critical"],
  ])("maps %d -> %s", (score, level) => {
    expect(statusForScore(score).level).toBe(level);
  });
});

describe("submissionScore", () => {
  it("scores missing as 0", () => {
    expect(submissionScore({ status: "missing", dueAt: 0 })).toBe(0);
  });

  it("scores on-time submission as 100", () => {
    expect(submissionScore({ status: "submitted", dueAt: 0 })).toBe(100);
  });

  it("decays late submissions toward 0 within the grace window", () => {
    const dueAt = 0;
    const oneDayLateMs = 24 * 60 * 60 * 1000;
    const score = submissionScore({
      status: "late",
      dueAt,
      submittedAt: oneDayLateMs,
      lateGraceHours: 48,
    });
    expect(score).toBe(50);
  });

  it("floors late score at 0 past the grace window", () => {
    const score = submissionScore({
      status: "late",
      dueAt: 0,
      submittedAt: 1000 * 60 * 60 * 100,
      lateGraceHours: 48,
    });
    expect(score).toBe(0);
  });
});

describe("qualityScoreFromChecklist", () => {
  it("returns 100 when there are no checklist items", () => {
    expect(qualityScoreFromChecklist([])).toBe(100);
  });

  it("computes earned/max as a percentage", () => {
    const items = [
      { points: 10, maxPoints: 10 },
      { points: 0, maxPoints: 10 },
      { points: 5, maxPoints: 10 },
    ];
    expect(qualityScoreFromChecklist(items)).toBe(50);
  });
});

describe("finalReportScore", () => {
  it("weights submission 40% and quality 60%", () => {
    expect(finalReportScore(100, 85)).toBe(91);
  });
});

describe("departmentHealthScore / organizationHealthScore", () => {
  it("computes a weighted average", () => {
    const reports = [
      { score: 90, weight: 1 },
      { score: 70, weight: 1 },
    ];
    expect(departmentHealthScore(reports)).toBe(80);
  });

  it("returns 0 for empty input", () => {
    expect(departmentHealthScore([])).toBe(0);
    expect(organizationHealthScore([])).toBe(0);
  });
});

describe("submissionRate", () => {
  it("ignores pending items and counts submitted+late as submitted", () => {
    const statuses: ("submitted" | "late" | "missing" | "pending")[] = [
      "submitted",
      "late",
      "missing",
      "pending",
    ];
    expect(submissionRate(statuses)).toBe(67);
  });

  it("returns 100 when everything is pending", () => {
    expect(submissionRate(["pending", "pending"])).toBe(100);
  });
});
