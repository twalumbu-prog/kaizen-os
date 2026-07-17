import { mutation } from "./_generated/server";

const BANK_RECONCILIATION_RULES = [
  { key: "openingBalance", label: "Opening balance must match", enabled: true, tolerance: 0.01 },
  { key: "closingBalance", label: "Closing balance must match", enabled: true, tolerance: 0.01 },
  { key: "debitsReconcile", label: "Debit total equals bank inflows", enabled: true },
  { key: "creditsReconcile", label: "Credit total equals bank outflows", enabled: true },
  { key: "duplicates", label: "Duplicate Transactions", enabled: true },
  { key: "missingEntries", label: "Missing Transactions", enabled: true },
  { key: "outstandingCheques", label: "Outstanding Cheques", enabled: true },
  { key: "depositsInTransit", label: "Deposits in Transit", enabled: true },
  { key: "bankCharges", label: "Bank Charges Accounted For", enabled: true },
  { key: "interest", label: "Interest Accounted For", enabled: true },
  { key: "unknownTransactions", label: "Unknown Transactions", enabled: true },
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
        { label: "Internal Ledger", fileType: "xlsx", required: true },
        { label: "Bank Statement", fileType: "xlsx", required: true },
        { label: "Supporting Documents", fileType: "pdf", required: false },
      ],
      validationRules: BANK_RECONCILIATION_RULES,
    });

    return { status: "seeded", orgId, departmentId, templateId };
  },
});
