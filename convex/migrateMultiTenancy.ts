import { mutation } from "./_generated/server";

export const migrate = mutation({
  args: {},
  handler: async (ctx) => {
    let org = await ctx.db.query("organizations").first();
    let orgId;
    if (!org) {
      orgId = await ctx.db.insert("organizations", { name: "Default Organization" });
    } else {
      orgId = org._id;
    }

    const profiles = await ctx.db.query("profiles").collect();
    let count = 0;
    for (const p of profiles) {
      if (!(p as any).orgId) {
        await ctx.db.patch(p._id, { orgId });
        count++;
      }
    }

    return `Migrated ${count} profiles to org ${orgId}`;
  }
});
