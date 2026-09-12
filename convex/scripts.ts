import { mutation } from "./_generated/server";

const STATUTORY_RULES = [
  { key: "payePaidOnTime", label: "PAYE Paid on Time", enabled: true },
  { key: "payePeriodMatch", label: "PAYE Period Match", enabled: true },
  { key: "napsaPaidOnTime", label: "NAPSA Paid on Time", enabled: true },
  { key: "napsaPeriodMatch", label: "NAPSA Period Match", enabled: true },
  { key: "nhimaPaidOnTime", label: "NHIMA Paid on Time", enabled: true },
  { key: "nhimaPeriodMatch", label: "NHIMA Period Match", enabled: true },
];

const PAYROLL_RULES = [
  { key: "netPayFormula", label: "Net Pay Formula", enabled: true },
  { key: "staffSalariesMatch", label: "Staff Salaries Match", enabled: true },
  { key: "napsaExpenseMatch", label: "NAPSA Expense Match", enabled: true },
  { key: "nhimaExpenseMatch", label: "NHIMA Expense Match", enabled: true },
  { key: "napsaPayableDouble", label: "NAPSA Payable Double", enabled: true },
  { key: "nhimaPayableDouble", label: "NHIMA Payable Double", enabled: true },
  { key: "zraPayableMatch", label: "ZRA Tax Payable Match", enabled: true },
  { key: "deductionsControlMatch", label: "Deductions Control Match", enabled: true },
  { key: "netPayControlMatch", label: "Net Pay Control Match", enabled: true },
  { key: "journalBalanced", label: "Journal Balanced", enabled: true },
];

export const updateStatutoryAndPayroll = mutation({
  args: {},
  handler: async (ctx) => {
    const org = await ctx.db
      .query("organizations")
      .filter((q) => q.eq(q.field("name"), "Twalumbu Education Centre"))
      .first();

    if (!org) {
      throw new Error("Twalumbu Education Centre not found");
    }

    const department = await ctx.db
      .query("departments")
      .withIndex("by_orgId", (q) => q.eq("orgId", org._id))
      .filter((q) => q.eq(q.field("name"), "Finance"))
      .first();

    if (!department) {
      throw new Error("Finance department not found in Twalumbu Education Centre");
    }

    // 1. Update or create Statutory Return Receipts template
    const statutoryTpl = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", department._id))
      .filter((q) => q.eq(q.field("name"), "Statutory Return Receipts"))
      .first();

    if (statutoryTpl) {
      await ctx.db.patch(statutoryTpl._id, {
        cadence: "monthly",
        validatorKey: "statutoryReceipts",
        requiredFiles: [
          { label: "PAYE Receipt", fileTypes: ["pdf"], required: true },
          { label: "NAPSA Receipt", fileTypes: ["pdf"], required: true },
          { label: "NHIMA Receipt", fileTypes: ["pdf"], required: true },
        ],
        validationRules: STATUTORY_RULES,
      });
    } else {
      await ctx.db.insert("reportTemplates", {
        departmentId: department._id,
        name: "Statutory Return Receipts",
        cadence: "monthly",
        validatorKey: "statutoryReceipts",
        weight: 1,
        requiredFiles: [
          { label: "PAYE Receipt", fileTypes: ["pdf"], required: true },
          { label: "NAPSA Receipt", fileTypes: ["pdf"], required: true },
          { label: "NHIMA Receipt", fileTypes: ["pdf"], required: true },
        ],
        validationRules: STATUTORY_RULES,
      });
    }

    // 2. Update or create Payroll template
    const payrollTpl = await ctx.db
      .query("reportTemplates")
      .withIndex("by_departmentId", (q) => q.eq("departmentId", department._id))
      .filter((q) => q.eq(q.field("name"), "Payroll"))
      .first();

    if (payrollTpl) {
      await ctx.db.patch(payrollTpl._id, {
        cadence: "monthly",
        validatorKey: "payroll",
        requiredFiles: [
          { label: "Payroll Register", fileTypes: ["xlsx"], required: true },
          { label: "Payroll Journal Extract", fileTypes: ["xlsx"], required: true },
          { label: "QuickBooks Data", fileTypes: ["xlsx"], required: false },
        ],
        validationRules: PAYROLL_RULES,
      });
    } else {
      await ctx.db.insert("reportTemplates", {
        departmentId: department._id,
        name: "Payroll",
        cadence: "monthly",
        validatorKey: "payroll",
        weight: 1,
        requiredFiles: [
          { label: "Payroll Register", fileTypes: ["xlsx"], required: true },
          { label: "Payroll Journal Extract", fileTypes: ["xlsx"], required: true },
          { label: "QuickBooks Data", fileTypes: ["xlsx"], required: false },
        ],
        validationRules: PAYROLL_RULES,
      });
    }

    return "Updated Statutory Return Receipts and Payroll templates with NAPSA, NHIMA, and PAYE requirements.";
  },
});
