import type {
  ChecklistItem,
  ParsedFile,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from "./types";

// ─── Points per check ─────────────────────────────────────────────────────────

const CHECK_POINTS: Record<string, number> = {
  payePaidOnTime: 40,
  napsaPaidOnTime: 40,
  nhimaPaidOnTime: 40,
  payePeriodMatch: 10,
  napsaPeriodMatch: 10,
  nhimaPeriodMatch: 10,
};

export function statutoryReceiptsMaxPoints(rules: ValidationRule[]): number {
  return Object.keys(CHECK_POINTS).reduce((sum, key) => {
    const rule = rules.find((r) => r.key === key);
    return rule?.enabled ? sum + CHECK_POINTS[key] : sum;
  }, 0);
}

function ruleEnabled(rules: ValidationRule[], key: string): boolean {
  return rules.find((r) => r.key === key)?.enabled ?? true;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

/**
 * Returns the submission deadline for a reporting period:
 * the 5th calendar day of the month immediately following the period end.
 *
 * E.g. period ending 31 July 2025 → deadline is 5 August 2025 (end of day, UTC).
 */
function deadlineForPeriodEnd(periodEndMs: number): Date {
  const d = new Date(periodEndMs);
  // Advance to the first day of the next month, then set day = 5.
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-indexed
  return new Date(Date.UTC(year, month + 1, 5, 23, 59, 59, 999));
}

/** Format a Date as "5 Aug 2025" for human-readable messages. */
function formatDate(d: Date): string {
  return d.toLocaleDateString("en-ZM", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * The coverage period the submission is for, derived from periodStart.
 * Returns "yyyy-MM" so it matches what the receipt parser produces.
 */
function submissionPeriod(periodStartMs: number): string {
  const d = new Date(periodStartMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

// ─── Per-receipt validation helpers ──────────────────────────────────────────

interface ReceiptMeta {
  entityType: string | null;
  paymentDate: string | null;
  coveragePeriod: string | null;
  amount: number | null;
  receiptNumber: string | null;
}

function extractMeta(file: ParsedFile): ReceiptMeta {
  const m = file.statement.metadata ?? {};
  return {
    entityType: (m.entityType as string) ?? null,
    paymentDate: (m.paymentDate as string) ?? null,
    coveragePeriod: (m.coveragePeriod as string) ?? null,
    amount: typeof m.amount === "number" ? m.amount : null,
    receiptNumber: (m.receiptNumber as string) ?? null,
  };
}

function checkPaidOnTime(
  key: string,
  title: string,
  meta: ReceiptMeta | null,
  deadline: Date,
  points: number,
): ChecklistItem {
  if (!meta) {
    return {
      title,
      status: "fail",
      explanation: "Receipt file was not uploaded or could not be parsed.",
      severity: "critical",
      points: 0,
      maxPoints: points,
    };
  }

  if (!meta.paymentDate) {
    return {
      title,
      status: "fail",
      explanation: "Payment date could not be extracted from the receipt PDF.",
      severity: "critical",
      points: 0,
      maxPoints: points,
    };
  }

  const paid = new Date(meta.paymentDate + "T00:00:00Z");
  const onTime = paid <= deadline;
  const amtNote = meta.amount !== null ? ` (ZMW ${meta.amount.toLocaleString()})` : "";
  const refNote = meta.receiptNumber ? ` — Ref: ${meta.receiptNumber}` : "";

  return {
    title,
    status: onTime ? "pass" : "fail",
    explanation: onTime
      ? `Paid on ${formatDate(paid)}${amtNote}${refNote}, within the ${formatDate(deadline)} deadline.`
      : `Paid on ${formatDate(paid)}${amtNote}${refNote}, which is AFTER the ${formatDate(deadline)} deadline.`,
    severity: onTime ? "low" : "critical",
    points: onTime ? points : 0,
    maxPoints: points,
  };
}

function checkPeriodMatch(
  key: string,
  title: string,
  meta: ReceiptMeta | null,
  expectedPeriod: string,
  points: number,
): ChecklistItem {
  if (!meta) {
    return {
      title,
      status: "fail",
      explanation: "Receipt file was not uploaded or could not be parsed.",
      severity: "high",
      points: 0,
      maxPoints: points,
    };
  }

  if (!meta.coveragePeriod) {
    return {
      title,
      status: "warning",
      explanation: "Coverage period could not be extracted from the receipt PDF.",
      severity: "medium",
      points: 0,
      maxPoints: points,
    };
  }

  const match = meta.coveragePeriod === expectedPeriod;
  return {
    title,
    status: match ? "pass" : "fail",
    explanation: match
      ? `Receipt covers period ${meta.coveragePeriod}, which matches the submission period.`
      : `Receipt covers period ${meta.coveragePeriod} but the submission is for ${expectedPeriod}. Wrong month uploaded?`,
    severity: match ? "low" : "high",
    points: match ? points : 0,
    maxPoints: points,
  };
}

// ─── Validator ────────────────────────────────────────────────────────────────

export async function statutoryReceiptsValidator(
  files: ParsedFile[],
  rules: ValidationRule[],
  context: ValidationContext,
): Promise<ValidationResult> {
  const deadline = deadlineForPeriodEnd(context.periodEnd);
  const expectedPeriod = submissionPeriod(context.periodStart);

  // Find the PAYE and NAPSA receipt files by their parsed entityType.
  // Falls back to label-based matching so the validator still works even if
  // the entity-detection regex misses an edge case.
  const payeFile =
    files.find((f) => (f.statement.metadata?.entityType as string) === "ZRA_PAYE") ??
    files.find((f) => /paye|zra/i.test(f.label)) ??
    null;

  const napsaFile =
    files.find((f) => (f.statement.metadata?.entityType as string) === "NAPSA") ??
    files.find((f) => /napsa|pension/i.test(f.label)) ??
    null;

  const nhimaFile =
    files.find((f) => (f.statement.metadata?.entityType as string) === "NHIMA") ??
    files.find((f) => /nhima/i.test(f.label)) ??
    null;

  const payeMeta = payeFile ? extractMeta(payeFile) : null;
  const napsaMeta = napsaFile ? extractMeta(napsaFile) : null;
  const nhimaMeta = nhimaFile ? extractMeta(nhimaFile) : null;

  const checklist: ChecklistItem[] = [];

  if (ruleEnabled(rules, "payePeriodMatch")) {
    checklist.push(
      checkPeriodMatch(
        "payePeriodMatch",
        "PAYE receipt covers the correct period",
        payeMeta,
        expectedPeriod,
        CHECK_POINTS.payePeriodMatch,
      ),
    );
  }

  if (ruleEnabled(rules, "napsaPeriodMatch")) {
    checklist.push(
      checkPeriodMatch(
        "napsaPeriodMatch",
        "NAPSA receipt covers the correct period",
        napsaMeta,
        expectedPeriod,
        CHECK_POINTS.napsaPeriodMatch,
      ),
    );
  }

  if (ruleEnabled(rules, "payePaidOnTime")) {
    checklist.push(
      checkPaidOnTime(
        "payePaidOnTime",
        `PAYE paid on or before ${formatDate(deadline)}`,
        payeMeta,
        deadline,
        CHECK_POINTS.payePaidOnTime,
      ),
    );
  }

  if (ruleEnabled(rules, "napsaPaidOnTime")) {
    checklist.push(
      checkPaidOnTime(
        "napsaPaidOnTime",
        `NAPSA paid on or before ${formatDate(deadline)}`,
        napsaMeta,
        deadline,
        CHECK_POINTS.napsaPaidOnTime,
      ),
    );
  }

  if (ruleEnabled(rules, "nhimaPeriodMatch")) {
    checklist.push(
      checkPeriodMatch(
        "nhimaPeriodMatch",
        "NHIMA receipt covers the correct period",
        nhimaMeta,
        expectedPeriod,
        CHECK_POINTS.nhimaPeriodMatch,
      ),
    );
  }

  if (ruleEnabled(rules, "nhimaPaidOnTime")) {
    checklist.push(
      checkPaidOnTime(
        "nhimaPaidOnTime",
        `NHIMA paid on or before ${formatDate(deadline)}`,
        nhimaMeta,
        deadline,
        CHECK_POINTS.nhimaPaidOnTime,
      ),
    );
  }

  const earnedPoints = checklist.reduce((s, c) => s + c.points, 0);
  const maxScore = checklist.reduce((s, c) => s + c.maxPoints, 0);
  // The caller (finalReportScore) expects a 0-100 percentage, same as every
  // other validator — earnedPoints alone would be out of this validator's
  // own 150-point max, overstating quality by up to 1.5x wherever it landed.
  const pct = maxScore > 0 ? Math.round((earnedPoints / maxScore) * 100) : 0;

  const failures = checklist.filter((c) => c.status === "fail");
  const warnings = checklist.filter((c) => c.status === "warning");

  let summary: string;
  if (failures.length === 0 && warnings.length === 0) {
    summary = `All statutory payments for ${expectedPeriod} were made on time. Score: ${earnedPoints}/${maxScore} (${pct}%).`;
  } else if (failures.some((c) => c.title.includes("on time"))) {
    summary = `One or more statutory payments were made AFTER the ${formatDate(deadline)} deadline. Score: ${earnedPoints}/${maxScore} (${pct}%).`;
  } else {
    summary = `Statutory receipts submitted with ${failures.length + warnings.length} issue(s). Score: ${earnedPoints}/${maxScore} (${pct}%).`;
  }

  const recommendations: string[] = [];
  if (failures.some((c) => c.title.includes("PAYE") && c.title.includes("on time"))) {
    recommendations.push(`Ensure PAYE is paid by the 5th of the following month to avoid ZRA penalties.`);
  }
  if (failures.some((c) => c.title.includes("NAPSA") && c.title.includes("on time"))) {
    recommendations.push(`Ensure NAPSA contributions are remitted by the 5th of the following month.`);
  }
  if (failures.some((c) => c.title.includes("NHIMA") && c.title.includes("on time"))) {
    recommendations.push(`Ensure NHIMA returns are remitted by the 5th of the following month.`);
  }
  if (failures.some((c) => c.title.includes("period"))) {
    recommendations.push(`Double-check that the uploaded receipt matches the reporting period before submitting.`);
  }

  return { score: pct, checklist, summary, recommendations };
}
