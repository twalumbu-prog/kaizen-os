import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { Infer, v } from "convex/values";
import { FILE_TYPE } from "./schema";

/**
 * Creates Blue Opus's department structure and its reports — matching what's
 * actually configured in local dev, not the org's original shape (the Daily
 * Ad Performance Tracking Sheet was since upgraded from a plain
 * document-submission report to one wired into the Meta Ads API; this
 * mirrors that), plus a new Sales Outreach Summary report.
 *
 * Every department is created, even the ones with no reports configured yet
 * (Customer Service, Accounting, Finance, Software Development) — they exist
 * as real placeholders, ready for reports the same way Twalumbu's Compliance
 * department was added after the fact.
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

interface FileSpec {
  label: string;
  /** Formats this slot accepts — defaults to just PDF when omitted. */
  fileTypes?: FileType[];
}

interface ReportSpec {
  name: string;
  cadence: "daily" | "weekly";
  validatorKey: "documentSubmission" | "adPerformance";
  weight: number;
  validationRules: { key: string; label: string; enabled: boolean }[];
  files: FileSpec[];
}

interface DepartmentSpec {
  name: string;
  slug: string;
  reports: ReportSpec[];
}

const DEPARTMENTS: DepartmentSpec[] = [
  { name: "Customer Service", slug: "customer-service", reports: [] },
  { name: "Accounting", slug: "accounting", reports: [] },
  { name: "Finance", slug: "finance", reports: [] },
  { name: "Software Development", slug: "software-development", reports: [] },
  {
    name: "Marketing",
    slug: "marketing",
    reports: [
      {
        name: "Weekly Newsletter",
        cadence: "weekly",
        validatorKey: "documentSubmission",
        weight: 1,
        validationRules: TIMELINESS_ONLY_RULES,
        files: [{ label: "Newsletter", fileTypes: ["pdf"] }],
      },
      {
        name: "Image Ad",
        cadence: "weekly",
        validatorKey: "documentSubmission",
        weight: 1,
        validationRules: TIMELINESS_ONLY_RULES,
        files: [
          { label: "Image Ad 1", fileTypes: ["jpg"] },
          { label: "Image Ad 2", fileTypes: ["jpg"] },
          { label: "Image Ad 3", fileTypes: ["jpg"] },
          { label: "Image Ad 4", fileTypes: ["jpg"] },
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
        files: [{ label: "Ad Performance Report", fileTypes: ["xlsx"] }],
      },
      {
        name: "Posting Schedule - Weekly",
        cadence: "weekly",
        validatorKey: "documentSubmission",
        weight: 1,
        validationRules: TIMELINESS_ONLY_RULES,
        files: [{ label: "Posting Schedule", fileTypes: ["xlsx"] }],
      },
    ],
  },
  {
    name: "Sales",
    slug: "sales",
    reports: [
      {
        // Each rep fills in the standard Word template (see
        // "Blue Opus - Sales Outreach Summary Template.docx"): every business
        // reached out to that week, the outcome, and whether/when there's a
        // follow-up — a PDF export of the same template is accepted too.
        name: "Sales Outreach Summary",
        cadence: "weekly",
        validatorKey: "documentSubmission",
        weight: 1,
        validationRules: TIMELINESS_ONLY_RULES,
        files: [{ label: "Sales Outreach Summary", fileTypes: ["docx", "pdf"] }],
      },
    ],
  },
];

export const seedReports = internalMutation({
  args: {},
  handler: async (ctx) => {
    let org = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("name"), ORG_NAME))
      .unique();

    if (!org) {
      const orgId = await ctx.db.insert("organizations", { name: ORG_NAME });
      org = (await ctx.db.get(orgId))!;
    }

    const existingDepartments = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .collect();

    const created: string[] = [];
    const skipped: string[] = [];

    for (const dept of DEPARTMENTS) {
      const department = existingDepartments.find((d) => d.name === dept.name);
      let departmentId: Id<"departments">;
      if (!department) {
        departmentId = await ctx.db.insert("departments", {
          orgId: org._id,
          name: dept.name,
          slug: dept.slug,
        });
        created.push(`department: ${dept.name}`);
      } else {
        departmentId = department._id;
        skipped.push(`department: ${dept.name}`);
      }

      if (dept.reports.length === 0) continue;

      const existingReports = await ctx.db
        .query("reportTemplates")
        .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
        .collect();

      for (const report of dept.reports) {
        if (existingReports.some((t) => t.name === report.name)) {
          skipped.push(`${dept.name} / ${report.name}`);
          continue;
        }

        await ctx.db.insert("reportTemplates", {
          departmentId,
          name: report.name,
          cadence: report.cadence,
          validatorKey: report.validatorKey,
          weight: report.weight,
          requiredFiles: report.files.map((f) => ({
            label: f.label,
            fileTypes: f.fileTypes ?? ["pdf"],
            required: true,
          })),
          validationRules: report.validationRules,
        });
        created.push(`${dept.name} / ${report.name}`);
      }
    }

    return { orgId: org._id, created, skipped };
  },
});

export const configureMetaIntegration = internalMutation({
  args: {
    accessToken: v.string(),
    adAccountId: v.optional(v.string()),
    appId: v.optional(v.string()),
    appSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let org = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("name"), ORG_NAME))
      .unique();

    if (!org) {
      const orgId = await ctx.db.insert("organizations", { name: ORG_NAME });
      org = (await ctx.db.get(orgId))!;
    }

    const config = JSON.stringify({
      accessToken: args.accessToken,
      adAccountId: args.adAccountId ?? "",
      appId: args.appId ?? "",
      appSecret: args.appSecret ?? "",
    });

    const existing = await ctx.db
      .query("integrations")
      .withIndex("by_orgId_provider", (q) =>
        q.eq("orgId", org._id).eq("provider", "meta")
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "active",
        config,
      });
      return { orgId: org._id, integrationId: existing._id, status: "updated" };
    } else {
      const id = await ctx.db.insert("integrations", {
        orgId: org._id,
        provider: "meta",
        status: "active",
        config,
      });
      return { orgId: org._id, integrationId: id, status: "created" };
    }
  },
});
