import type { ChecklistItem, ParsedFile, ValidationResult } from "./types";

export function mew3DailyReconMaxPoints(): number {
  return 100;
}

/**
 * The daily reconciliation workbook is produced by an automation
 * (convex/mew3Recon.ts) that has already run every check. Its Summary sheet
 * carries them as `checksJson`, and this replays them as the checklist so
 * the submission page shows exactly what matched and what did not.
 */
export async function mew3DailyReconValidator(files: ParsedFile[]): Promise<ValidationResult> {
  const meta = files[0]?.statement.metadata ?? {};
  let checks: ChecklistItem[] = [];
  try {
    checks = JSON.parse(String(meta.checksJson ?? "[]")) as ChecklistItem[];
  } catch {}
  if (!checks.length) {
    return {
      score: 0,
      checklist: [{ title: "Reconciliation generated", status: "fail", explanation: "The workbook has no checks on its Summary sheet.", severity: "critical", points: 0, maxPoints: 100 }],
      summary: "The reconciliation workbook could not be read.",
      recommendations: ["Run the MEW3 Daily Reconciliation automation again."],
    };
  }
  const score = typeof meta.score === "number" ? meta.score : 0;
  const failed = checks.filter((c) => c.status === "fail");
  return {
    score,
    checklist: checks,
    summary: failed.length
      ? `${failed.length} of ${checks.length} reconciliation checks failed: ${failed.map((c) => c.title.toLowerCase()).join("; ")}.`
      : "Guest register, receipts, deposits and MoneyWise all agree.",
    recommendations: failed.length ? ["Open the workbook — the Guests, Receipts and MoneyWise sheets list each item that does not match."] : [],
  };
}
