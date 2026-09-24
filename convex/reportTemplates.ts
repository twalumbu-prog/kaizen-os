import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { AI_EXTRACTION_FIELD, CADENCE, CYCLE_CONFIG, FILE_TYPE, OUTCOME_BENCHMARK } from "./schema";
const SHARING_MODE = v.union(v.literal("individual"), v.literal("shared"));
import { requireProfile, requireRole } from "./lib/roles";

export const listByDepartment = query({
  args: { departmentId: v.id("departments") },
  handler: async (ctx, { departmentId }) => {
    await requireProfile(ctx);
    return await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", departmentId))
      .collect();
  },
});

export const get = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireProfile(ctx);
    return await ctx.db.get(templateId);
  },
});

export const listFinanceTemplates = query({
  args: {},
  handler: async (ctx) => {
    const profile = await requireProfile(ctx);
    // Fetch all departments for this org
    const departments = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", profile.orgId))
      .collect();
    
    // Fetch all templates for these departments
    const allTemplates = await Promise.all(
      departments.map(dept => 
        ctx.db.query("reportTemplates")
          .withIndex("by_departmentId", (q) => q.eq("departmentId", dept._id))
          .collect()
      )
    );
    
    // Flatten and filter for bankReconciliation
    return allTemplates.flat().filter(t => t.validatorKey === "bankReconciliation");
  },
});

const REFERENCE_FILE = v.object({
  storageId: v.id("_storage"),
  fileName: v.string(),
  fileType: FILE_TYPE,
  kind: v.union(v.literal("template"), v.literal("sample")),
});

const REQUIRED_FILES = v.array(
  v.object({
    label: v.string(),
    fileTypes: v.array(FILE_TYPE),
    required: v.boolean(),
    referenceFile: v.optional(REFERENCE_FILE),
  }),
);

function assertEveryRequiredFileHasAFormat(requiredFiles: { label: string; fileTypes: string[] }[]) {
  const empty = requiredFiles.find((f) => f.fileTypes.length === 0);
  if (empty) throw new Error(`"${empty.label}" needs at least one accepted file format.`);
}
const VALIDATION_RULES = v.array(
  v.object({
    key: v.string(),
    label: v.string(),
    enabled: v.boolean(),
    tolerance: v.optional(v.number()),
  }),
);

export const create = mutation({
  args: {
    departmentId: v.id("departments"),
    name: v.string(),
    cadence: CADENCE,
    cycle: v.optional(CYCLE_CONFIG),
    dueDayOfMonth: v.optional(v.number()),
    validatorKey: v.string(),
    weight: v.number(),
    sharingMode: v.optional(SHARING_MODE),
    startingBalance: v.optional(v.number()),
    excludedDaysOfWeek: v.optional(v.array(v.number())),
    excludedDates: v.optional(v.array(v.string())),
    outcomeBenchmark: v.optional(OUTCOME_BENCHMARK),
    requiredFiles: REQUIRED_FILES,
    validationRules: VALIDATION_RULES,
    quickbooksAccountId: v.optional(v.string()),
    aiExtractionFields: v.optional(v.array(AI_EXTRACTION_FIELD)),
  },
  handler: async (ctx, args) => {
    await requireRole(ctx, ["admin"]);
    assertEveryRequiredFileHasAFormat(args.requiredFiles);
    return await ctx.db.insert("reportTemplates", args);
  },
});

export const update = mutation({
  args: {
    templateId: v.id("reportTemplates"),
    name: v.optional(v.string()),
    cadence: v.optional(CADENCE),
    cycle: v.optional(CYCLE_CONFIG),
    dueDayOfMonth: v.optional(v.number()),
    weight: v.optional(v.number()),
    sharingMode: v.optional(SHARING_MODE),
    startingBalance: v.optional(v.number()),
    excludedDaysOfWeek: v.optional(v.array(v.number())),
    excludedDates: v.optional(v.array(v.string())),
    outcomeBenchmark: v.optional(OUTCOME_BENCHMARK),
    requiredFiles: v.optional(REQUIRED_FILES),
    validationRules: v.optional(VALIDATION_RULES),
    quickbooksAccountId: v.optional(v.string()),
    aiExtractionFields: v.optional(v.array(AI_EXTRACTION_FIELD)),
  },
  handler: async (ctx, { templateId, ...patch }) => {
    await requireRole(ctx, ["admin"]);
    if (patch.requiredFiles) assertEveryRequiredFileHasAFormat(patch.requiredFiles);
    const fields = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    await ctx.db.patch(templateId, fields);
  },
});

/**
 * Attaches a reference file to one required-file slot — a blank template to
 * fill in, or a sample of what a real submission looks like (for documents
 * nobody templates, like a government receipt). Overwrites whatever was
 * there before; the old storage object is not deleted, matching how
 * replaceSubmissionFile already leaves a superseded upload orphaned rather
 * than adding delete-on-replace behaviour nothing else in this file has.
 */
export const setRequiredFileReference = mutation({
  args: {
    templateId: v.id("reportTemplates"),
    fileLabel: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    fileType: FILE_TYPE,
    kind: v.union(v.literal("template"), v.literal("sample")),
  },
  handler: async (ctx, { templateId, fileLabel, storageId, fileName, fileType, kind }) => {
    await requireRole(ctx, ["admin"]);
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Report not found");

    const match = template.requiredFiles.find((f) => f.label === fileLabel);
    if (!match) throw new Error(`No required file named "${fileLabel}" on this report`);

    const requiredFiles = template.requiredFiles.map((f) =>
      f.label === fileLabel
        ? { ...f, referenceFile: { storageId, fileName, fileType, kind } }
        : f,
    );
    await ctx.db.patch(templateId, { requiredFiles });
  },
});

export const removeRequiredFileReference = mutation({
  args: { templateId: v.id("reportTemplates"), fileLabel: v.string() },
  handler: async (ctx, { templateId, fileLabel }) => {
    await requireRole(ctx, ["admin"]);
    const template = await ctx.db.get(templateId);
    if (!template) throw new Error("Report not found");

    const requiredFiles = template.requiredFiles.map((f) =>
      f.label === fileLabel ? { label: f.label, fileTypes: f.fileTypes, required: f.required } : f,
    );
    await ctx.db.patch(templateId, { requiredFiles });
  },
});

/**
 * The downloadable/previewable reference files for a report — what the "..."
 * menu on a Work Calendar row shows. Open to any signed-in org member (same
 * as `get`), not just admins: this is what employees use to grab a template
 * before submitting.
 */
export const listReferenceFiles = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (!template) return [];

    const results: { label: string; kind: "template" | "sample"; fileName: string; url: string }[] = [];
    for (const f of template.requiredFiles) {
      if (!f.referenceFile) continue;
      const url = await ctx.storage.getUrl(f.referenceFile.storageId);
      if (!url) continue;
      results.push({ label: f.label, kind: f.referenceFile.kind, fileName: f.referenceFile.fileName, url });
    }
    return results;
  },
});

export const getExtractedFields = query({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await requireProfile(ctx);
    const template = await ctx.db.get(templateId);
    if (!template) return [];

    const defaultFieldsMap: Record<string, Array<{ key: string; label: string }>> = {
      canteenSalesRecon: [
        { key: "studentCount", label: "Sales Volume (Students Count)" },
        { key: "staffSalesVolume", label: "Staff Sales Volume" },
        { key: "grandTotal", label: "Total Sales Amount" },
        { key: "closingBalance", label: "Closing Cash/Bank Balance" },
      ],
      adPerformance: [
        { key: "impressions", label: "Impressions" },
        { key: "clicks", label: "Clicks" },
        { key: "conversions", label: "Conversions" },
        { key: "adSpend", label: "Total Ad Spend" },
        { key: "roas", label: "Return on Ad Spend (ROAS)" },
        { key: "cpc", label: "Cost Per Click (CPC)" },
        { key: "ctr", label: "Click-Through Rate (CTR %)" },
      ],
      payroll: [
        { key: "netPay", label: "Net Pay" },
        { key: "totalGrossPay", label: "Total Gross Pay / Salaries" },
        { key: "napsaPayable", label: "NAPSA Payable" },
        { key: "nhimaPayable", label: "NHIMA Payable" },
        { key: "employeeCount", label: "Total Employees Count" },
      ],
      statutoryReceipts: [
        { key: "receiptTotal", label: "Receipt Total Amount" },
        { key: "taxAmount", label: "Tax Amount Paid" },
        { key: "closingBalance", label: "Closing Balance" },
      ],
      documentSubmission: [
        { key: "complianceScore", label: "Document Relevance / Compliance Score" },
        { key: "receiptTotal", label: "Document Total Amount" },
        { key: "transactionCount", label: "Item / Line Count" },
      ],
      bankReconciliation: [
        { key: "closingBalance", label: "Closing Bank Balance" },
        { key: "openingBalance", label: "Opening Bank Balance" },
        { key: "transactionCount", label: "Total Transactions Count" },
      ],
    };

    const knownForValidator = defaultFieldsMap[template.validatorKey] ?? [
      { key: "closingBalance", label: "Closing Balance" },
      { key: "openingBalance", label: "Opening Balance" },
      { key: "transactionCount", label: "Total Transactions Count" },
    ];

    const fieldsMap = new Map<string, string>();
    for (const item of knownForValidator) {
      fieldsMap.set(item.key, item.label);
    }

    fieldsMap.set("closingBalance", "Closing Balance");
    fieldsMap.set("openingBalance", "Opening Balance");
    fieldsMap.set("transactionCount", "Transaction Count");

    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_templateId", (q) => q.eq("templateId", templateId))
      .order("desc")
      .take(20);

    for (const sub of submissions) {
      const files = await ctx.db
        .query("submissionFiles")
        .withIndex("by_submissionId", (q) => q.eq("submissionId", sub._id))
        .collect();

      for (const file of files) {
        if (file.extracted?.metadata) {
          for (const key of Object.keys(file.extracted.metadata)) {
            if (!fieldsMap.has(key) && key !== "fileName" && key !== "fileType" && key !== "fileSize") {
              const formattedLabel = key
                .replace(/([A-Z])/g, " $1")
                .replace(/_/g, " ")
                .replace(/^\w/, (c) => c.toUpperCase());
              fieldsMap.set(key, formattedLabel);
            }
          }
        }
      }
    }

    return Array.from(fieldsMap.entries()).map(([key, label]) => ({ key, label }));
  },
});
