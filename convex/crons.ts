import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Proactive gap detection: even if no employee logs in, overdue periods
// still surface as "missing" submissions on dashboards the next day.
crons.daily(
  "detect missing submissions",
  { hourUTC: 1, minuteUTC: 0 },
  internal.submissions.backfillAllMissingSubmissions,
);

crons.daily(
  "send-report-reminders",
  { hourUTC: 8, minuteUTC: 0 },
  internal.reminders.processReminders
);

crons.daily(
  "auto-submit-ad-performance",
  { hourUTC: 7, minuteUTC: 0 },
  internal.adReports.autoSubmitAll,
);

// After the school day: reconcile canteen subscriptions against the inventory
// report and submit the deviation report for any new dates.
crons.daily(
  "canteen-deviation-automation",
  { hourUTC: 17, minuteUTC: 0 },
  internal.canteenAutomation.runAllScheduled,
);

// Pick up new job applications from the careers inbox and log them as talent leads.
crons.interval(
  "recruitment-talent-leads",
  { hours: 24 },
  internal.recruitmentAutomation.runAllScheduled,
);

// End of day: fetch Zanaco bank inflows from Master Fees and pre-populate
// the reconciliation submission so the finance team can just upload the
// bank statement the next morning and complete the 3-way check.
crons.daily(
  "zanaco-bank-recon",
  { hourUTC: 22, minuteUTC: 0 },
  internal.zanacoRecon.runAllScheduled,
);

// 06:00 Lusaka: re-run MEW3 Apartments' daily reconciliation for the two
// previous days, so revenue entered in MoneyWise after the documents were
// submitted is picked up.
crons.daily(
  "mew3-daily-reconciliation",
  { hourUTC: 4, minuteUTC: 0 },
  internal.mew3Recon.runAllScheduled,
);

export default crons;
