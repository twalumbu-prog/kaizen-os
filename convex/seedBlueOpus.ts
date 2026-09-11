import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Infer } from "convex/values";
import { FILE_TYPE } from "./schema";

/**
 * Creates Blue Opus's department structure and its Marketing reports —
 * matching what's actually configured in local dev, not the org's original
 * shape (the Daily Ad Performance Tracking Sheet was since upgraded from a
 * plain document-submission report to one wired into the Meta Ads API; this
 * mirrors that).
 *
 * Every department is created, even the five with no reports configured yet
 * (Customer Service, Accounting, Sales, Finance, Software Development) — they
 * exist as real placeholders in local dev, ready for reports the same way
 * Twalumbu's Compliance department was added after the fact.
 *
 * The Ad Performance report is harmless to create without a connected Meta
 * integration: convex/adReports.ts's daily auto-submit only looks at orgs
 * with an *active* Meta integration (see findTargets) and silently skips
 * everyone else — it does not error. Connecting Meta Ads for this org is a
 * separate step, done through Settings → Integrations with real credentials,
 * not something this script can or should do.
 *
 * Requires the "Blue Opus Software" organization to already exist — create it
 * by signing up with that org name (the first signup becomes admin) before
 * running this.
 *
 * Safe to re-run: departments and reports are matched by name and skipped if
 * they already exist.
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
  validatorKey: "documentSubmission" | "adPerformance";
  weight: number;
  validationRules: { key: string; label: string; enabled: boolean }[];
  files: { label: string; fileType?: FileType }[];
}

/** Departments with no reports configured yet — placeholders, same as any department created empty via Settings. */
const EMPTY_DEPARTMENTS = [
  { name: "Customer Service", slug: "customer-service" },
  { name: "Accounting", slug: "accounting" },
  { name: "Sales", slug: "sales" },
  { name: "Finance", slug: "finance" },
  { name: "Software Development", slug: "software-development" },
];

const MARKETING_REPORTS: ReportSpec[] = [
  {
    name: "Weekly Newsletter",
    cadence: "weekly",
    validatorKey: "documentSubmission",
    weight: 1,
    validationRules: TIMELINESS_ONLY_RULES,
    files: [{ label: "Newsletter", fileType: "pdf" }],
  },
  {
    name: "Image Ad",
    cadence: "weekly",
    validatorKey: "documentSubmission",
    weight: 1,
    validationRules: TIMELINESS_ONLY_RULES,
    files: [
      { label: "Image Ad 1", fileType: "jpg" },
      { label: "Image Ad 2", fileType: "jpg" },
      { label: "Image Ad 3", fileType: "jpg" },
      { label: "Image Ad 4", fileType: "jpg" },
    ],
  },
  {
    // Matches convex/seeds/adPerformanceTemplate.ts exactly — the Meta
    // Ads-integrated validator, not a plain document-submission report.
    name: "Daily Ad Performance Tracking Sheet",
    cadence: "daily",
    validatorKey: "adPerformance",
    weight: 100,
    validationRules: [],
    files: [{ label: "Ad Performance Report", fileType: "xlsx" }],
  },
  {
    name: "Posting Schedule - Weekly",
    cadence: "weekly",
    validatorKey: "documentSubmission",
    weight: 1,
    validationRules: TIMELINESS_ONLY_RULES,
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

    for (const spec of EMPTY_DEPARTMENTS) {
      if (departments.some((d) => d.name === spec.name)) {
        skipped.push(`department: ${spec.name}`);
        continue;
      }
      await ctx.db.insert("departments", { orgId: org._id, ...spec });
      created.push(`department: ${spec.name}`);
    }

    const marketing = departments.find((d) => d.name === "Marketing");
    let marketingId: Id<"departments">;
    if (!marketing) {
      marketingId = await ctx.db.insert("departments", {
        orgId: org._id,
        name: "Marketing",
        slug: "marketing",
      });
      created.push("department: Marketing");
    } else {
      marketingId = marketing._id;
    }

    const existingReports = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", marketingId))
      .collect();

    for (const report of MARKETING_REPORTS) {
      if (existingReports.some((t) => t.name === report.name)) {
        skipped.push(`Marketing / ${report.name}`);
        continue;
      }

      await ctx.db.insert("reportTemplates", {
        departmentId: marketingId,
        name: report.name,
        cadence: report.cadence,
        validatorKey: report.validatorKey,
        weight: report.weight,
        requiredFiles: report.files.map((f) => ({
          label: f.label,
          fileType: f.fileType ?? ("pdf" as const),
          required: true,
        })),
        validationRules: report.validationRules,
      });
      created.push(`Marketing / ${report.name}`);
    }

    return { orgId: org._id, created, skipped };
  },
});
