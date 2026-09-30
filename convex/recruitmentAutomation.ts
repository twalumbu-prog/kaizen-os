"use node";

import { v } from "convex/values";
import { Composio } from "@composio/core";
import { internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Recruitment talent-leads automation.
 *
 * Reads the careers inbox in Zoho Mail (via Composio), extracts each new job
 * application with an LLM, and appends it to the "Talent Leads Master List"
 * Google Sheet in Drive: Human Resources › 02_Recruitment & Hiring ›
 * Recruitment Leads & Contacts. Already-handled emails are never re-added.
 */

const FOLDER_PATH = ["Human Resources", "02_Recruitment & Hiring", "Recruitment Leads & Contacts"];
const HEADERS = [
  "Date Received",
  "Position Applied For",
  "Full Name",
  "Email",
  "Phone",
  "Qualifications",
  "Attachments",
  "Email Subject",
  "Email Message ID",
];
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const LOOKBACK_MS = 30 * 86_400_000;
const MAX_EMAILS = 100;

type Lead = {
  isApplication: boolean;
  position: string;
  fullName: string;
  email: string;
  phone: string;
  qualifications: string;
};

// ── Composio helpers ─────────────────────────────────────────────────────────

function composioClient() {
  return new Composio({ apiKey: process.env.COMPOSIO_API_KEY ?? "" });
}

async function run(composio: Composio, userId: string, slug: string, connectedAccountId: string, args: object) {
  const res = await (composio as any).tools.execute(slug, {
    userId,
    connectedAccountId,
    arguments: args,
    dangerouslySkipVersionCheck: true,
  });
  if (!res?.successful) throw new Error(`${slug} failed: ${String(res?.error ?? "unknown error").slice(0, 300)}`);
  return res.data;
}

async function accountFor(composio: Composio, orgId: string, toolkit: string, label: string): Promise<string> {
  const res = await composio.connectedAccounts.list({
    userIds: [orgId],
    toolkitSlugs: [toolkit],
    statuses: ["ACTIVE"],
  });
  const id = res.items?.[0]?.id;
  if (!id) throw new Error(`${label} is not connected for this organization. Connect it under Integrations.`);
  return id;
}

// ── Email parsing ────────────────────────────────────────────────────────────

const decode = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");

const htmlToText = (html: string) =>
  decode(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim(),
  );

const senderEmail = (from: string) => (decode(from).match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] ?? "").toLowerCase();

async function extractLead(subject: string, from: string, body: string): Promise<Lead | null> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  const prompt = `You process emails sent to a school's careers inbox. Decide whether this email is a job application / expression of interest from a candidate, and extract the details.

Return ONLY a JSON object:
{"isApplication": boolean, "position": string, "fullName": string, "email": string, "phone": string, "qualifications": string}

Rules:
- isApplication is false for newsletters, notifications, spam, replies from the school, vendor pitches, etc.
- position: the role applied for (from the subject or body); "" if not stated.
- fullName: the applicant's own name (not the school's).
- email: the applicant's contact email as stated in the message; if none is stated use the sender address.
- phone: the applicant's phone number as written; "" if none.
- qualifications: a concise summary of education, certifications/licences and relevant experience stated; "" if none.
Use "" for anything not present. Do not invent details.

From: ${from}
Subject: ${subject}
Body:
${body.slice(0, 6000)}`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://kaizen-os.app",
      "X-OpenRouter-Title": "Kaizen OS",
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  const j = JSON.parse(m[0]);
  const str = (x: unknown) => (typeof x === "string" ? x.trim() : "");
  return {
    isApplication: j.isApplication === true,
    position: str(j.position),
    fullName: str(j.fullName),
    email: str(j.email),
    phone: str(j.phone),
    qualifications: str(j.qualifications),
  };
}

// ── Drive helpers ────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function findChild(
  composio: Composio, userId: string, drive: string, name: string, mime: string, parentId?: string,
): Promise<{ id: string; webViewLink?: string } | null> {
  const q = [
    `name = '${esc(name)}'`,
    `mimeType = '${mime}'`,
    "trashed = false",
    parentId ? `'${parentId}' in parents` : null,
  ].filter(Boolean).join(" and ");
  const data = await run(composio, userId, "GOOGLEDRIVE_LIST_FILES", drive, {
    q,
    fields: "files(id,name,webViewLink)",
    pageSize: 10,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return data?.files?.[0] ?? null;
}

async function resolveFolder(composio: Composio, userId: string, drive: string): Promise<string> {
  let parent: string | undefined;
  for (const name of FOLDER_PATH) {
    const hit = await findChild(composio, userId, drive, name, FOLDER_MIME, parent);
    if (!hit) throw new Error(`Drive folder "${FOLDER_PATH.join(" › ")}" not found (missing "${name}").`);
    parent = hit.id;
  }
  return parent!;
}

async function ensureSheet(
  composio: Composio, userId: string, drive: string, sheets: string, folderId: string, title: string,
): Promise<{ id: string; url: string }> {
  const existing = await findChild(composio, userId, drive, title, SHEET_MIME, folderId);
  if (existing) return { id: existing.id, url: existing.webViewLink ?? `https://docs.google.com/spreadsheets/d/${existing.id}` };

  const created = await run(composio, userId, "GOOGLESHEETS_CREATE_GOOGLE_SHEET1", sheets, {
    title,
    folder_id: folderId,
  });
  const id: string | undefined = created?.spreadsheetId ?? created?.response_data?.spreadsheetId ?? created?.spreadsheet_id;
  if (!id) throw new Error("Could not read the new spreadsheet's id from Composio.");
  await appendRows(composio, userId, sheets, id, [HEADERS]);
  return { id, url: `https://docs.google.com/spreadsheets/d/${id}` };
}

async function appendRows(composio: Composio, userId: string, sheets: string, sheetId: string, values: string[][]) {
  await run(composio, userId, "GOOGLESHEETS_SPREADSHEETS_VALUES_APPEND", sheets, {
    spreadsheetId: sheetId,
    range: "A1",
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    majorDimension: "ROWS",
    values,
  });
}

// ── Main run ─────────────────────────────────────────────────────────────────

async function runOne(ctx: ActionCtx, automationId: Id<"automations">, trigger: "schedule" | "manual") {
  const runId = await ctx.runMutation(internal.canteenAutomation.startRun, { automationId, trigger });
  const finish = (status: "success" | "skipped" | "failed", message: string) =>
    ctx.runMutation(internal.canteenAutomation.finishRun, {
      runId, status, message, datesProcessed: [], submissionIds: [],
    });

  try {
    const loaded = await ctx.runQuery(internal.recruitmentData.load, { automationId });
    if (!loaded) return await finish("failed", "Automation not found.");
    const { orgId, config } = loaded;
    const composio = composioClient();
    const zoho = await accountFor(composio, orgId, "zoho_mail", "Zoho Mail");
    const drive = await accountFor(composio, orgId, "googledrive", "Google Drive");
    const sheets = await accountFor(composio, orgId, "googlesheets", "Google Sheets");

    // 1. Recent inbox mail addressed to the careers address(es).
    const accounts = await run(composio, orgId, "ZOHO_MAIL_ACCOUNTS_LIST_ACCOUNTS", zoho, {});
    const zohoAccountId: string | undefined = accounts?.data?.[0]?.accountId;
    if (!zohoAccountId) throw new Error("No Zoho Mail account found.");
    const folders = await run(composio, orgId, "ZOHO_MAIL_FOLDERS_LIST_FOLDERS", zoho, { account_id: zohoAccountId });
    const inbox = (folders?.folders ?? []).find((f: any) => f.folder_type === "Inbox" && f.folder_name === "Inbox");
    if (!inbox) throw new Error("Zoho Inbox folder not found.");

    const listed = await run(composio, orgId, "ZOHO_MAIL_MESSAGES_LIST_EMAILS", zoho, {
      account_id: zohoAccountId,
      folder_id: inbox.folder_id,
      limit: MAX_EMAILS,
      sort_by: "date",
    });
    const cutoff = Date.now() - LOOKBACK_MS;
    const watch = config.matchAddresses.map((a) => a.toLowerCase());
    const candidates = ((listed?.data ?? []) as any[]).filter((m) => {
      const addrs = decode(`${m.toAddress ?? ""} ${m.ccAddress ?? ""}`).toLowerCase();
      return Number(m.receivedTime) >= cutoff && watch.some((w) => addrs.includes(w));
    });
    const freshIds: string[] = await ctx.runQuery(internal.recruitmentData.unprocessed, {
      automationId,
      itemIds: candidates.map((m) => String(m.messageId)),
    });
    const fresh = candidates.filter((m) => freshIds.includes(String(m.messageId)));
    if (fresh.length === 0) return await finish("skipped", `No new applications (${candidates.length} matching email(s) already handled).`);

    // 2. Extract the applicant details from each email.
    const rows: string[][] = [];
    const handled: Array<{ itemId: string; note: string }> = [];
    const skipped: string[] = [];
    for (const m of fresh.sort((a, b) => Number(a.receivedTime) - Number(b.receivedTime))) {
      const messageId = String(m.messageId);
      const content = await run(composio, orgId, "ZOHO_MAIL_MESSAGES_GET_MESSAGE_CONTENT", zoho, {
        account_id: zohoAccountId,
        folder_id: String(m.folderId ?? inbox.folder_id),
        message_id: messageId,
      });
      const body = htmlToText(String(content?.data?.content ?? content?.content ?? m.summary ?? ""));
      const subject = decode(String(m.subject ?? ""));
      const from = String(m.fromAddress ?? "");
      const lead = await extractLead(subject, from, body);
      if (!lead || !lead.isApplication) {
        handled.push({ itemId: messageId, note: "not an application" });
        skipped.push(subject);
        continue;
      }
      const attachments = String(m.hasAttachment) === "1" ? "Yes — see original email" : "";
      rows.push([
        new Date(Number(m.receivedTime)).toISOString().slice(0, 16).replace("T", " "),
        lead.position,
        lead.fullName,
        lead.email || senderEmail(from),
        lead.phone,
        lead.qualifications,
        attachments,
        subject,
        messageId,
      ]);
      handled.push({ itemId: messageId, note: `lead: ${lead.fullName || "(no name)"}` });
    }

    // 3. Append to the master list (create it in the HR folder on first use).
    if (rows.length > 0) {
      const folderId = await resolveFolder(composio, orgId, drive);
      const sheet = await ensureSheet(composio, orgId, drive, sheets, folderId, config.sheetTitle);
      if (sheet.id !== config.sheetId) await ctx.runMutation(internal.recruitmentData.saveSheet, {
        automationId, sheetId: sheet.id, sheetUrl: sheet.url,
      });
      await appendRows(composio, orgId, sheets, sheet.id, rows);
    }
    // Only mark handled once the rows are safely in the sheet.
    await ctx.runMutation(internal.recruitmentData.markProcessed, { automationId, items: handled });
    return await finish(
      "success",
      `Added ${rows.length} new lead(s) to "${config.sheetTitle}"${skipped.length ? `; ignored ${skipped.length} non-application email(s)` : ""}.`,
    );
  } catch (err) {
    console.error("[recruitmentAutomation] failed", err);
    await finish("failed", err instanceof Error ? err.message : String(err));
  }
}

export const runAutomation = internalAction({
  args: { automationId: v.id("automations"), trigger: v.union(v.literal("schedule"), v.literal("manual")) },
  handler: async (ctx, { automationId, trigger }) => {
    await runOne(ctx, automationId, trigger);
  },
});

/** Cron entry point. */
export const runAllScheduled = internalAction({
  args: {},
  handler: async (ctx) => {
    for (const id of await ctx.runQuery(internal.recruitmentData.listEnabled, {})) {
      await runOne(ctx, id, "schedule");
    }
  },
});
