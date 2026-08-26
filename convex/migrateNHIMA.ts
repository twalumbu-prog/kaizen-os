import { mutation } from "./_generated/server";

export default mutation({
  args: {},
  handler: async (ctx) => {
    // Find the Statutory Return template
    const template = await ctx.db
      .query("reportTemplates")
      .filter((q) => q.eq(q.field("validatorKey"), "statutoryReceipts"))
      .first();

    if (!template) {
      throw new Error("Statutory Return template not found");
    }

    // Add NHIMA to requiredFiles if it's not already there
    const requiredFiles = [...template.requiredFiles];
    if (!requiredFiles.some(f => f.label === "NHIMA Receipt")) {
      requiredFiles.push({
        label: "NHIMA Receipt",
        fileType: "pdf",
        required: true,
      });
    }

    // Ensure NHIMA validation rules are enabled
    const validationRules = [...template.validationRules];
    
    if (!validationRules.some(r => r.key === "nhimaPaidOnTime")) {
      validationRules.push({
        key: "nhimaPaidOnTime",
        label: "NHIMA Paid on Time",
        enabled: true,
      });
    } else {
      const rule = validationRules.find(r => r.key === "nhimaPaidOnTime")!;
      rule.enabled = true;
    }

    if (!validationRules.some(r => r.key === "nhimaPeriodMatch")) {
      validationRules.push({
        key: "nhimaPeriodMatch",
        label: "NHIMA Period Match",
        enabled: true,
      });
    } else {
      const rule = validationRules.find(r => r.key === "nhimaPeriodMatch")!;
      rule.enabled = true;
    }

    await ctx.db.patch(template._id, {
      requiredFiles,
      validationRules,
    });

    return "Migration completed successfully!";
  },
});
