import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Infer } from "convex/values";
import { FILE_TYPE } from "./schema";

/**
 * Creates Blue Opus's Marketing department reports.
 *
 * All four are evidence-of-work reports: nothing is extracted or checked for
 * correctness, they just need to arrive. They use the `documentSubmission`
 * validator with the AI relevance review disabled, so on-time/late/missing
 * submission is the only thing driving their score for now.
 *
 * Requires the "Blue Opus" organization to already exist — create it by
 * signing up with that org name (the first signup becomes admin) before
 * running this.
 *
 * Safe to re-run: the department and reports are matched by name and skipped
 * if they already exist.
 *
 * Run with: npx convex run seedBlueOpus:seedReports
 */

const ORG_NAME = "Blue Opus Software";

type FileType = Infer<typeof FILE_TYPE>;

/** Confirms the required files arrived; skips the AI relevance review entirely. */
const TIMELINESS_ONLY_RULES = [
  { key: "filesPresent", label: "Required files uploaded", enabled: true },
  { key: "documentRelevant", label: "Document matches the report requested", enabled: false },
];

interface ReportSpec {
  name: string;
  cadence: "daily" | "weekly";
  files: { label: string; fileType?: FileType }[];
}

const MARKETING_REPORTS: ReportSpec[] = [
  {
    name: "Weekly Newsletter",
    cadence: "weekly",
    files: [{ label: "Newsletter", fileType: "pdf" }],
  },
  {
    name: "Image Ad",
    cadence: "weekly",
    files: [
      { label: "Image Ad 1", fileType: "jpg" },
      { label: "Image Ad 2", fileType: "jpg" },
      { label: "Image Ad 3", fileType: "jpg" },
      { label: "Image Ad 4", fileType: "jpg" },
    ],
  },
  {
    name: "Daily Ad Performance Tracking Sheet",
    cadence: "daily",
    files: [{ label: "Ad Performance Tracking Sheet", fileType: "xlsx" }],
  },
  {
    name: "Posting Schedule - Weekly",
    cadence: "weekly",
    files: [{ label: "Posting Schedule", fileType: "xlsx" }],
  },
];

export const seedReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("name"), ORG_NAME))
      .unique();
    if (!org) throw new Error(`Organization "${ORG_NAME}" not found`);

    const departments = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const created: string[] = [];
    const skipped: string[] = [];

    let department = departments.find((d) => d.name === "Marketing");
    let departmentId: Id<"departments">;
    if (!department) {
      departmentId = await ctx.db.insert("departments", {
        orgId: org._id,
        name: "Marketing",
        slug: "marketing",
      });
      created.push("department: Marketing");
    } else {
      departmentId = department._id;
    }

    const existing = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .collect();

    for (const report of MARKETING_REPORTS) {
      if (existing.some((t) => t.name === report.name)) {
        skipped.push(`Marketing / ${report.name}`);
        continue;
      }

      await ctx.db.insert("reportTemplates", {
        departmentId,
        name: report.name,
        cadence: report.cadence,
        validatorKey: "documentSubmission",
        weight: 1,
        requiredFiles: report.files.map((f) => ({
          label: f.label,
          fileType: f.fileType ?? ("pdf" as const),
          required: true,
        })),
        validationRules: TIMELINESS_ONLY_RULES,
      });
      created.push(`Marketing / ${report.name}`);
    }

    return { orgId: org._id, created, skipped };
  },
});
