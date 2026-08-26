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

export default crons;
