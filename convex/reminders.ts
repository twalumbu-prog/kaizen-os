import { action, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { Resend } from "resend";

export const sendReminderEmail = action({
  args: { 
    orgId: v.id("organizations"),
    email: v.string(), 
    reportName: v.string(), 
    dueDate: v.number() 
  },
  handler: async (ctx, args) => {
    // 1. Fetch integration config for this org
    const integration = await ctx.runQuery(internal.integrations.getInternalIntegration, {
      orgId: args.orgId,
      provider: "resend"
    });

    if (!integration || integration.status !== "active" || !integration.config) {
      console.warn(`Resend integration not configured or inactive for org ${args.orgId}`);
      return;
    }

    let config;
    try {
      config = JSON.parse(integration.config);
    } catch (e) {
      console.error("Failed to parse Resend config", e);
      return;
    }

    if (!config.apiKey || !config.fromEmail) {
      console.warn("Resend API key or from email missing in config");
      return;
    }

    const resend = new Resend(config.apiKey);
    
    try {
      await resend.emails.send({
        from: config.fromEmail,
        to: args.email,
        subject: `Reminder: ${args.reportName} is Overdue`,
        html: `<p>Hello,</p><p>This is a reminder that your report <strong>${args.reportName}</strong> was due on ${new Date(args.dueDate).toLocaleDateString()}. Please log in to submit it as soon as possible.</p>`,
      });
      console.log(`Sent reminder for ${args.reportName} to ${args.email}`);
    } catch (error) {
      console.error("Failed to send Resend email", error);
    }
  }
});

export const processReminders = internalAction({
  args: {},
  handler: async (ctx, args) => {
    // This is a placeholder for where we would:
    // 1. Query for all overdue, unsubmitted reports
    // 2. Map them to users/orgs
    // 3. For each one, trigger sendReminderEmail
    console.log(`Processing reminders...`);
  }
});
