import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Infer } from "convex/values";
import { CADENCE, CYCLE_CONFIG, FILE_TYPE } from "./schema";

/**
 * Creates Twalumbu Education Centre's department reports.
 *
 * Almost all of them are evidence-of-work reports: scans of paperwork that
 * nothing is extracted from. They use the `documentSubmission` validator,
 * which confirms the expected files arrived and asks an AI reviewer whether
 * they look like what was asked for — the real signal being tracked is
 * whether people submit on time. The one exception is the Canteen Daily Sales
 * Report, which runs the existing canteenSalesRecon validator.
 *
 * Safe to re-run: departments and reports are matched by name and skipped if
 * they already exist.
 *
 * Run with: npx convex run seedTwalumbu:seedReports
 */

const ORG_NAME = "Twalumbu Education Centre";

type Cadence = Infer<typeof CADENCE>;
type CycleConfig = Infer<typeof CYCLE_CONFIG>;
type FileType = Infer<typeof FILE_TYPE>;

/**
 * School terms: 13 teaching weeks, opening the second week of January, with
 * roughly a month between terms. The gap is 31 days rather than 4 weeks so
 * three terms land on a 366-day year instead of drifting a week earlier
 * annually.
 */
const TERM: Omit<CycleConfig, "dueWeek"> = {
  anchor: Date.parse("2026-01-12T00:00:00Z"),
  lengthWeeks: 13,
  gapDays: 31,
  label: "Term",
};

/** The relevance-only checks every document-submission report runs. */
const DOCUMENT_RULES = [
  { key: "filesPresent", label: "Required documents attached", enabled: true },
  { key: "documentRelevant", label: "Document matches the report requested", enabled: true },
];

const CANTEEN_RECON_RULES = [
  { key: "datesMatch", label: "Recon and inventory cover the same day", enabled: true },
  { key: "timeliness", label: "Documents generated on the report date", enabled: true },
  { key: "childrenCountMatch", label: "Children fed matches the student rows", enabled: true },
  { key: "cashTotalCorrect", label: "Cash total adds up", enabled: true },
  { key: "airtelTotalCorrect", label: "Airtel total adds up", enabled: true },
  { key: "grandTotalCorrect", label: "Grand total equals cash plus airtel", enabled: true },
  { key: "depositMatchesRecon", label: "Deposit slip matches the amount banked", enabled: true },
];

interface ReportSpec {
  name: string;
  cadence: Cadence;
  cycle?: CycleConfig;
  /** Defaults to documentSubmission. */
  validatorKey?: string;
  /** Defaults to the document rules. */
  validationRules?: { key: string; label: string; enabled: boolean }[];
  files: { label: string; fileType?: FileType; required?: boolean }[];
}

interface DepartmentSpec {
  name: string;
  slug: string;
  /** Set when the department already exists under a different name. */
  renameFrom?: string;
  reports: ReportSpec[];
}

const PLAN: DepartmentSpec[] = [
  {
    name: "Academic",
    slug: "academic",
    reports: [
      {
        name: "Class Register",
        cadence: "weekly",
        files: [{ label: "Class Register" }],
      },
      {
        // Submitted every Friday for the week ahead, so one weekly submission
        // rather than a plan per teaching day.
        name: "Lesson Plans",
        cadence: "weekly",
        files: [{ label: "Lesson Plans" }],
      },
      {
        name: "Friday Quiz",
        cadence: "weekly",
        files: [
          { label: "Spellings Answer Sheet" },
          { label: "Mental Maths Answer Sheet" },
        ],
      },
      {
        name: "Weekly Class Test Student Answer Sheets",
        cadence: "weekly",
        files: [{ label: "Student Answer Sheets" }],
      },
      {
        // Two weeks before the middle of a 13-week term.
        name: "Mid Term Test",
        cadence: "cycle",
        cycle: { ...TERM, dueWeek: 5 },
        files: [{ label: "Mid Term Test Paper" }],
      },
      {
        // Two weeks before the term closes — week 11 of 13.
        name: "End of Term Test",
        cadence: "cycle",
        cycle: { ...TERM, dueWeek: 11 },
        files: [{ label: "End of Term Test Paper" }],
      },
    ],
  },
  {
    name: "Sales & Marketing",
    slug: "sales-marketing",
    renameFrom: "Marketing",
    reports: [
      {
        name: "Ad Content Creation",
        cadence: "weekly",
        files: [{ label: "Ad Creative" }],
      },
      {
        name: "Content Posting Schedule",
        cadence: "weekly",
        files: [{ label: "Posting Schedule" }],
      },
      {
        name: "Ad Campaign Performance Tracker",
        cadence: "monthly",
        files: [{ label: "Campaign Performance Tracker" }],
      },
      {
        name: "Lead Conversion Breakdown Report",
        cadence: "monthly",
        files: [{ label: "Completed Application Forms" }],
      },
    ],
  },
  {
    name: "Transportation",
    slug: "transportation",
    reports: [
      {
        name: "Transport Student Register",
        cadence: "weekly",
        files: [{ label: "Transport Student Register" }],
      },
      {
        name: "Transport Driver Clock In/Out Register",
        cadence: "weekday",
        files: [{ label: "Driver Clock In/Out Register" }],
      },
    ],
  },
  {
    name: "Quality Control",
    slug: "quality-control",
    reports: [
      {
        name: "Classroom Maintenance Inspection Standards Checklist",
        cadence: "monthly",
        files: [{ label: "Classroom Inspection Checklist" }],
      },
      {
        name: "Office Inspection Standards Checklist",
        cadence: "monthly",
        files: [{ label: "Office Inspection Checklist" }],
      },
      {
        name: "Ablution Inspection Standards Checklist",
        cadence: "monthly",
        files: [{ label: "Ablution Inspection Checklist" }],
      },
      {
        name: "Landscaping Inspection Standards Checklist",
        cadence: "monthly",
        files: [{ label: "Landscaping Inspection Checklist" }],
      },
    ],
  },
  {
    name: "Catering",
    slug: "catering",
    reports: [
      {
        name: "Canteen Daily Sales Report",
        cadence: "daily",
        validatorKey: "canteenSalesRecon",
        validationRules: CANTEEN_RECON_RULES,
        files: [
          { label: "Sales Collection Recon", fileType: "xlsx" },
          { label: "Inventory", fileType: "xlsx" },
          { label: "Proof of Payment", fileType: "pdf" },
        ],
      },
      {
        name: "Canteen Inventory Stock Usage Report",
        cadence: "daily",
        files: [{ label: "Inventory Stock Usage Report" }],
      },
      {
        name: "Canteen Daily Cost Per Plate Valuation Report",
        cadence: "daily",
        files: [{ label: "Cost Per Plate Valuation" }],
      },
    ],
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

    for (const spec of PLAN) {
      // ── Department ──────────────────────────────────────────────────────
      const department =
        departments.find((d) => d.name === spec.name) ??
        (spec.renameFrom ? departments.find((d) => d.name === spec.renameFrom) : undefined);

      let departmentId: Id<"departments">;
      if (!department) {
        departmentId = await ctx.db.insert("departments", {
          orgId: org._id,
          name: spec.name,
          slug: spec.slug,
        });
        created.push(`department: ${spec.name}`);
      } else {
        departmentId = department._id;
        if (department.name !== spec.name) {
          await ctx.db.patch(departmentId, { name: spec.name, slug: spec.slug });
          created.push(`renamed department: ${department.name} → ${spec.name}`);
        }
      }

      // ── Reports ─────────────────────────────────────────────────────────
      const existing = await ctx.db
        .query("reportTemplates")
        .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
        .collect();

      for (const report of spec.reports) {
        if (existing.some((t) => t.name === report.name)) {
          skipped.push(`${spec.name} / ${report.name}`);
          continue;
        }

        await ctx.db.insert("reportTemplates", {
          departmentId,
          name: report.name,
          cadence: report.cadence,
          ...(report.cycle ? { cycle: report.cycle } : {}),
          validatorKey: report.validatorKey ?? "documentSubmission",
          weight: 1,
          requiredFiles: report.files.map((f) => ({
            label: f.label,
            fileType: f.fileType ?? ("pdf" as const),
            required: f.required ?? true,
          })),
          validationRules: report.validationRules ?? DOCUMENT_RULES,
        });
        created.push(`${spec.name} / ${report.name}`);
      }
    }

    return { orgId: org._id, created, skipped };
  },
});
