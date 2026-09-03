export type IntegrationCategory =
  | "Finance"
  | "Communication"
  | "Productivity"
  | "Developer Tools"
  | "AI"
  | "Storage"
  | "Social Media";

export const CATEGORIES: IntegrationCategory[] = [
  "Finance",
  "Communication",
  "Productivity",
  "Developer Tools",
  "AI",
  "Storage",
  "Social Media",
];

export type CatalogEntry = {
  /** Unique slug — for native integrations this matches the `integrations.provider` value;
   *  for Composio-backed apps it's the Composio app slug (e.g. "gmail"). */
  slug: string;
  name: string;
  description: string;
  category: IntegrationCategory;
  /** "native" integrations have their own dedicated Convex actions and OAuth flow.
   *  "composio" integrations are connected generically through Composio. */
  kind: "native" | "composio";
  /** Route to navigate to when the tile is selected. */
  href: string;
  /** Domain used to load the brand logo via Google's favicon service (e.g. "slack.com").
   *  If the image fails to load the tile falls back to `initials`. */
  domain: string;
  /** Optional direct logo URL — overrides the favicon service when set.
   *  Use for products that share a parent domain (Google Workspace apps, Meta, etc.). */
  logoUrl?: string;
  /** Short initials/label rendered in the tile's icon badge as a fallback. */
  initials: string;
  /** Tailwind classes for the icon badge background + text color (used for fallback badge). */
  iconClassName: string;
};

export const INTEGRATIONS: CatalogEntry[] = [
  // ── Native integrations ─────────────────────────────────────────────────
  {
    slug: "quickbooks",
    name: "QuickBooks Online",
    description: "Sync bank accounts, fetch live transaction data, and automate reconciliation reports.",
    category: "Finance",
    kind: "native",
    href: "/admin/integrations/quickbooks",
    domain: "quickbooks.intuit.com",
    initials: "QB",
    iconClassName: "bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
  {
    slug: "resend",
    name: "Resend",
    description: "Automatically send email reminders to employees with pending or overdue reports.",
    category: "Communication",
    kind: "native",
    href: "/admin/integrations/resend",
    domain: "resend.com",
    initials: "Re",
    iconClassName: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  },
  {
    slug: "google_drive",
    name: "Google Drive",
    description: "Automatically save and organize submitted reports and evidence into your organization's Drive.",
    category: "Storage",
    kind: "native",
    href: "/admin/integrations/drive",
    domain: "drive.google.com",
    logoUrl: "https://logos.composio.dev/api/googledrive",
    initials: "Dr",
    iconClassName: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    slug: "google_ai",
    name: "Google AI",
    description: "Leverage Gemini to review submissions, flag anomalies, and power AI agents.",
    category: "AI",
    kind: "native",
    href: "/admin/integrations/ai",
    domain: "gemini.google.com",
    logoUrl: "https://logos.composio.dev/api/gemini",
    initials: "Ai",
    iconClassName: "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  },

  // ── Meta (Facebook & Instagram) ─────────────────────────────────────────
  {
    slug: "meta",
    name: "Facebook Ads",
    description: "Pull live campaign performance — spend, impressions, clicks, and CTR — from your Meta Ad Account.",
    category: "Social Media",
    kind: "native",
    href: "/admin/integrations/meta",
    domain: "meta.com",
    logoUrl: "https://cdn.simpleicons.org/meta/0081FB",
    initials: "M",
    iconClassName: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  {
    slug: "instagram_insights",
    name: "Instagram Insights",
    description: "View post reach, likes, and comments for your connected Instagram Business Account.",
    category: "Social Media",
    kind: "native",
    href: "/admin/integrations/meta",
    domain: "instagram.com",
    initials: "Ig",
    iconClassName: "bg-pink-50 text-pink-600 dark:bg-pink-900/30 dark:text-pink-400",
  },

  // ── Composio-backed apps ────────────────────────────────────────────────
  {
    slug: "gmail",
    name: "Gmail",
    description: "Read, search, and send email through a connected Gmail account.",
    category: "Communication",
    kind: "composio",
    href: "/admin/integrations/composio/gmail",
    domain: "gmail.com",
    logoUrl: "https://logos.composio.dev/api/gmail",
    initials: "Gm",
    iconClassName: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  },
  {
    slug: "googlesheets",
    name: "Google Sheets",
    description: "Read and write spreadsheet data for reporting and data automation.",
    category: "Productivity",
    kind: "composio",
    href: "/admin/integrations/composio/googlesheets",
    domain: "sheets.google.com",
    logoUrl: "https://logos.composio.dev/api/googlesheets",
    initials: "Sh",
    iconClassName: "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400",
  },
  {
    slug: "googlecalendar",
    name: "Google Calendar",
    description: "Schedule and manage events directly from Business OS.",
    category: "Productivity",
    kind: "composio",
    href: "/admin/integrations/composio/googlecalendar",
    domain: "calendar.google.com",
    logoUrl: "https://logos.composio.dev/api/googlecalendar",
    initials: "Ca",
    iconClassName: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    slug: "slack",
    name: "Slack",
    description: "Post messages and notifications to your team's Slack workspace.",
    category: "Communication",
    kind: "composio",
    href: "/admin/integrations/composio/slack",
    domain: "slack.com",
    logoUrl: "https://logos.composio.dev/api/slack",
    initials: "Sl",
    iconClassName: "bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400",
  },
  {
    slug: "notion",
    name: "Notion",
    description: "Create and update pages and databases in your Notion workspace.",
    category: "Productivity",
    kind: "composio",
    href: "/admin/integrations/composio/notion",
    domain: "notion.so",
    logoUrl: "https://logos.composio.dev/api/notion",
    initials: "No",
    iconClassName: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  },
  {
    slug: "github",
    name: "GitHub",
    description: "Manage issues, pull requests, and repositories.",
    category: "Developer Tools",
    kind: "composio",
    href: "/admin/integrations/composio/github",
    domain: "github.com",
    logoUrl: "https://logos.composio.dev/api/github",
    initials: "Gh",
    iconClassName: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  },
  {
    slug: "linear",
    name: "Linear",
    description: "Create and track issues in your Linear workspace.",
    category: "Developer Tools",
    kind: "composio",
    href: "/admin/integrations/composio/linear",
    domain: "linear.app",
    logoUrl: "https://logos.composio.dev/api/linear",
    initials: "Li",
    iconClassName: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
  },
  {
    slug: "airtable",
    name: "Airtable",
    description: "Read and write records across your Airtable bases.",
    category: "Productivity",
    kind: "composio",
    href: "/admin/integrations/composio/airtable",
    domain: "airtable.com",
    logoUrl: "https://logos.composio.dev/api/airtable",
    initials: "At",
    iconClassName: "bg-cyan-50 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400",
  },
  {
    slug: "whatsapp",
    name: "WhatsApp",
    description: "Send messages and notifications over WhatsApp.",
    category: "Communication",
    kind: "composio",
    href: "/admin/integrations/composio/whatsapp",
    domain: "whatsapp.com",
    logoUrl: "https://logos.composio.dev/api/whatsapp",
    initials: "Wa",
    iconClassName: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  },
  {
    slug: "zoom",
    name: "Zoom",
    description: "Schedule and manage video meetings.",
    category: "Communication",
    kind: "composio",
    href: "/admin/integrations/composio/zoom",
    domain: "zoom.us",
    logoUrl: "https://logos.composio.dev/api/zoom",
    initials: "Zm",
    iconClassName: "bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  },
  {
    slug: "outlook",
    name: "Outlook",
    description: "Read and send email through a connected Outlook account.",
    category: "Communication",
    kind: "composio",
    href: "/admin/integrations/composio/outlook",
    domain: "outlook.com",
    logoUrl: "https://logos.composio.dev/api/outlook",
    initials: "Ol",
    iconClassName: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    slug: "googlemeet",
    name: "Google Meet",
    description: "Create and manage video meeting links.",
    category: "Communication",
    kind: "composio",
    href: "/admin/integrations/composio/googlemeet",
    domain: "meet.google.com",
    logoUrl: "https://logos.composio.dev/api/googlemeet",
    initials: "Me",
    iconClassName: "bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400",
  },
  {
    slug: "hubspot",
    name: "HubSpot",
    description: "Sync contacts, deals, and CRM records.",
    category: "Finance",
    kind: "composio",
    href: "/admin/integrations/composio/hubspot",
    domain: "hubspot.com",
    logoUrl: "https://logos.composio.dev/api/hubspot",
    initials: "Hs",
    iconClassName: "bg-orange-50 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400",
  },
  {
    slug: "jira",
    name: "Jira",
    description: "Create and track issues across Jira projects.",
    category: "Developer Tools",
    kind: "composio",
    href: "/admin/integrations/composio/jira",
    domain: "atlassian.com",
    logoUrl: "https://logos.composio.dev/api/jira",
    initials: "Ji",
    iconClassName: "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    slug: "discord",
    name: "Discord",
    description: "Post messages and notifications to a Discord server.",
    category: "Social Media",
    kind: "composio",
    href: "/admin/integrations/composio/discord",
    domain: "discord.com",
    logoUrl: "https://logos.composio.dev/api/discord",
    initials: "Di",
    iconClassName: "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400",
  },
  {
    slug: "twitter",
    name: "Twitter / X",
    description: "Post and read content on X (formerly Twitter).",
    category: "Social Media",
    kind: "composio",
    href: "/admin/integrations/composio/twitter",
    domain: "x.com",
    logoUrl: "https://logos.composio.dev/api/twitter",
    initials: "X",
    iconClassName: "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100",
  },
  {
    slug: "youtube",
    name: "YouTube",
    description: "Search videos and manage channel content.",
    category: "Social Media",
    kind: "composio",
    href: "/admin/integrations/composio/youtube",
    domain: "youtube.com",
    logoUrl: "https://logos.composio.dev/api/youtube",
    initials: "Yt",
    iconClassName: "bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400",
  },
];

export function getCatalogEntry(slug: string): CatalogEntry | undefined {
  return INTEGRATIONS.find((i) => i.slug === slug);
}
