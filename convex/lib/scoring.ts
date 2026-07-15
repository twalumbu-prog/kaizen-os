// Pure scoring functions shared by Convex functions and the frontend.
// No Convex imports here so this stays unit-testable in isolation.

export type StatusLevel = "excellent" | "good" | "average" | "poor" | "critical";

export const STATUS_BANDS: { min: number; level: StatusLevel; label: string; color: string }[] = [
  { min: 95, level: "excellent", label: "Excellent", color: "green" },
  { min: 85, level: "good", label: "Good", color: "blue" },
  { min: 70, level: "average", label: "Average", color: "yellow" },
  { min: 50, level: "poor", label: "Poor", color: "orange" },
  { min: 0, level: "critical", label: "Critical", color: "red" },
];

export function statusForScore(score: number) {
  for (const band of STATUS_BANDS) {
    if (score >= band.min) return band;
  }
  return STATUS_BANDS[STATUS_BANDS.length - 1];
}

const SUBMISSION_WEIGHT = 0.4;
const QUALITY_WEIGHT = 0.6;

/**
 * Submission score based on how a report was submitted relative to its
 * due date. Late submissions decay linearly to 0 by `lateGraceHours` past
 * the deadline; missing reports score 0.
 */
export function submissionScore(params: {
  status: "submitted" | "late" | "missing" | "pending";
  dueAt: number;
  submittedAt?: number;
  lateGraceHours?: number;
}): number {
  const { status, dueAt, submittedAt, lateGraceHours = 48 } = params;
  if (status === "missing" || status === "pending") return 0;
  if (status === "submitted") return 100;
  // late
  if (submittedAt === undefined) return 0;
  const hoursLate = (submittedAt - dueAt) / (1000 * 60 * 60);
  const decay = Math.max(0, 1 - hoursLate / lateGraceHours);
  return Math.round(decay * 100);
}

/** Quality score as a 0-100 percentage of earned checklist points. */
export function qualityScoreFromChecklist(
  items: { points: number; maxPoints: number }[],
): number {
  const totalMax = items.reduce((sum, i) => sum + i.maxPoints, 0);
  if (totalMax === 0) return 100;
  const totalEarned = items.reduce((sum, i) => sum + i.points, 0);
  return Math.round((totalEarned / totalMax) * 100);
}

/** Combines submission consistency and quality into one report score. */
export function finalReportScore(submission: number, quality: number): number {
  return Math.round(submission * SUBMISSION_WEIGHT + quality * QUALITY_WEIGHT);
}

/** Weighted average of report scores into a department health score. */
export function departmentHealthScore(
  reports: { score: number; weight: number }[],
): number {
  const totalWeight = reports.reduce((sum, r) => sum + r.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = reports.reduce((sum, r) => sum + r.score * r.weight, 0);
  return Math.round(weighted / totalWeight);
}

/** Weighted average of department scores into an organization health score. */
export function organizationHealthScore(
  departments: { score: number; weight: number }[],
): number {
  return departmentHealthScore(departments);
}

export function submissionRate(
  statuses: ("submitted" | "late" | "missing" | "pending")[],
): number {
  const relevant = statuses.filter((s) => s !== "pending");
  if (relevant.length === 0) return 100;
  const submitted = relevant.filter((s) => s === "submitted" || s === "late").length;
  return Math.round((submitted / relevant.length) * 100);
}
