import type { ParsedFile, ValidationResult, ValidationRule } from "./types";
import type { AdRow } from "../lib/parsers/adPerformance";

export function adPerformanceMaxPoints(_rules: ValidationRule[]): number {
  return 100;
}

export async function adPerformanceValidator(
  files: ParsedFile[],
  _rules: ValidationRule[],
): Promise<ValidationResult> {
  if (files.length === 0) {
    return {
      score: 0,
      checklist: [
        {
          title: "File submitted",
          status: "fail",
          explanation: "No ad performance file was submitted.",
          severity: "critical",
          points: 0,
          maxPoints: 100,
        },
      ],
      summary: "No ad performance file submitted.",
      recommendations: ["Submit the Daily Ad Performance Tracking Sheet."],
    };
  }

  const meta = files[0].statement.metadata ?? {};
  const rowCount          = Number(meta.rowCount ?? 0);
  const hasRequiredColumns = Number(meta.hasRequiredColumns ?? 0) === 1;

  const rows: AdRow[] = meta.rows
    ? (JSON.parse(meta.rows as string) as AdRow[])
    : [];

  const platforms = [...new Set(rows.map((r) => r.platform))].filter(Boolean);
  const hasPlausibleCtr = rows.every((r) => r.ctr >= 0 && r.ctr <= 100);

  const checklist: ValidationResult["checklist"] = [
    {
      title: "Required columns present",
      status: hasRequiredColumns ? "pass" : "fail",
      explanation: hasRequiredColumns
        ? "All required columns are present: Date, Ad Name, Format, Platform, Views, Engagements, Link Clicks, CTR, Engagement Rate."
        : "One or more required columns are missing.",
      severity: "high",
      points: hasRequiredColumns ? 40 : 0,
      maxPoints: 40,
    },
    {
      title: "Ad rows found",
      status: rowCount > 0 ? "pass" : "fail",
      explanation: rowCount > 0
        ? `${rowCount} ad row${rowCount !== 1 ? "s" : ""} across ${platforms.join(", ") || "unknown"} platform${platforms.length !== 1 ? "s" : ""}.`
        : "No data rows found in the file.",
      severity: "critical",
      points: rowCount > 0 ? 40 : 0,
      maxPoints: 40,
    },
    {
      title: "CTR values plausible",
      status: hasPlausibleCtr ? "pass" : "warning",
      explanation: hasPlausibleCtr
        ? "All CTR values are in the expected 0–100% range."
        : "Some CTR values appear outside the 0–100% range.",
      severity: "medium",
      points: hasPlausibleCtr ? 20 : 10,
      maxPoints: 20,
    },
  ];

  const score = checklist.reduce((sum, c) => sum + c.points, 0);

  return {
    score,
    checklist,
    summary:
      rowCount > 0
        ? `Ad performance report: ${rowCount} ads across ${platforms.join(", ") || "unknown"} platform${platforms.length !== 1 ? "s" : ""}.`
        : "Empty ad performance report.",
    recommendations:
      hasRequiredColumns && rowCount > 0
        ? []
        : ["Ensure the sheet has all required columns and at least one data row."],
  };
}
