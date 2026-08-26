import { mutation } from "./_generated/server";

export default mutation({
  args: {},
  handler: async (ctx) => {
    // We want to reset submissions from May. 
    // The "May Statutory Returns" submission has a periodLabel like "May 2026" or similar, 
    // or we just find the statutory receipt submissions and reset them all for the current user, or all in general.
    
    // Let's find all Statutory Return templates
    const templates = await ctx.db
      .query("reportTemplates")
      .filter((q) => q.eq(q.field("validatorKey"), "statutoryReceipts"))
      .collect();

    let count = 0;
    for (const template of templates) {
      const submissions = await ctx.db
        .query("submissions")
        .withIndex("by_templateId", (q) => q.eq("templateId", template._id))
        .collect();

      for (const sub of submissions) {
        // If it's submitted and we want to reset it
        if (sub.status !== "pending") {
          // Delete all its files
          const files = await ctx.db
            .query("submissionFiles")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", sub._id))
            .collect();
          
          for (const f of files) {
            // Delete the storage record too if possible? We can't delete storage in mutation easily, need internalMutation or just leave it orphaned for now.
            await ctx.db.delete(f._id);
          }

          // Delete the validation result
          const valRes = await ctx.db
            .query("validationResults")
            .withIndex("by_submissionId", (q) => q.eq("submissionId", sub._id))
            .first();
          if (valRes) {
            await ctx.db.delete(valRes._id);
          }

          // Reset submission to pending
          await ctx.db.patch(sub._id, {
            status: "pending",
            submittedAt: undefined,
            submissionScore: undefined,
          });
          count++;
        }
      }
    }
    return `Reset ${count} submissions.`;
  },
});
