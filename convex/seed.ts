import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";

const BANK_RECONCILIATION_RULES = [
  { key: "openingBalance", label: "Opening balance must match", enabled: true, tolerance: 0.01 },
  { key: "closingBalance", label: "Closing balance must match", enabled: true, tolerance: 0.01 },
  { key: "openingBalanceContinuity", label: "Opening balance continuity", enabled: true, tolerance: 0.01 },
  { key: "debitsReconcile", label: "Debit total equals bank inflows", enabled: true },
  { key: "creditsReconcile", label: "Credit total equals bank outflows", enabled: true },
  { key: "duplicates", label: "Duplicate Transactions", enabled: false },
  { key: "missingEntries", label: "Missing Transactions", enabled: false },
  { key: "outstandingCheques", label: "Outstanding Cheques", enabled: true },
  { key: "depositsInTransit", label: "Deposits in Transit", enabled: true },
  { key: "bankCharges", label: "Bank Charges Accounted For", enabled: true },
  { key: "interest", label: "Interest Accounted For", enabled: true },
  { key: "unknownTransactions", label: "Unknown Transactions", enabled: false },
];

/**
 * Seeds the organization structure for the Phase 1 MVP: one organization,
 * the Finance department, and the Weekly Bank Reconciliation report
 * template. Users are not seeded here — sign up through the app; the first
 * account becomes an admin automatically (see convex/profiles.ts) and can
 * then assign roles/departments to everyone else from the admin UI.
 *
 * Run with: npx convex run seed:seedFinance
 */
export const seedFinance = mutation({
  args: {},
  handler: async (ctx) => {
    const existingOrg = await ctx.db.query("organizations").first();
    if (existingOrg !== null) {
      return { status: "already-seeded", orgId: existingOrg._id };
    }

    const orgId = await ctx.db.insert("organizations", { name: "Acme Corporation" });

    const departmentId = await ctx.db.insert("departments", {
      orgId,
      name: "Finance",
      slug: "finance",
    });

    const templateId = await ctx.db.insert("reportTemplates", {
      departmentId,
      name: "Weekly Bank Reconciliation",
      cadence: "weekly",
      validatorKey: "bankReconciliation",
      weight: 1,
      requiredFiles: [
        { label: "Internal Ledger", fileTypes: ["xlsx"], required: true },
        { label: "Bank Statement", fileTypes: ["xlsx"], required: true },
        { label: "Supporting Documents", fileTypes: ["pdf"], required: false },
      ],
      validationRules: BANK_RECONCILIATION_RULES,
    });

    return { status: "seeded", orgId, departmentId, templateId };
  },
});

/** Internal-only, CLI-driven config fix: syncs a template's rules to the current defaults above. */
export const devSyncValidationRules = internalMutation({
  args: { templateId: v.id("reportTemplates") },
  handler: async (ctx, { templateId }) => {
    await ctx.db.patch(templateId, { validationRules: BANK_RECONCILIATION_RULES });
  },
});
