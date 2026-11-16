/** Turns a message returned by Composio's GMAIL_FETCH_EMAILS into what the inbox stores. */

export type ParsedEmail = {
  id: string;
  threadId: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  body: string;
  at: number;
  /** Sent by the connected mailbox itself. */
  outbound: boolean;
};

const decode = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim(),
  );
}

/** Drops the quoted history a reply carries, keeping only what the sender just wrote. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const cut = lines.findIndex(
    (l, i) =>
      /^On .{5,200}wrote:\s*$/i.test(l.trim()) ||
      /^-{2,}\s*Original Message\s*-{2,}/i.test(l.trim()) ||
      (/^From:\s/.test(l) && /^(Sent|Date):\s/.test(lines[i + 1] ?? "")),
  );
  const kept = (cut === -1 ? lines : lines.slice(0, cut)).filter((l) => !l.trimStart().startsWith(">"));
  return kept.join("\n").trim();
}

export function parseSender(from: string): { name: string; email: string } {
  const decoded = decode(from ?? "").trim();
  const email = (decoded.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/)?.[0] ?? "").toLowerCase();
  const name = decoded.replace(/<[^>]*>/g, "").replace(/["']/g, "").trim();
  return { name: name && !name.includes("@") ? name : "", email };
}

export function parseGmailMessage(raw: Record<string, any>, ownEmail: string): ParsedEmail | null {
  const id = String(raw.messageId ?? raw.id ?? "");
  const threadId = String(raw.threadId ?? "");
  if (!id || !threadId) return null;

  const labels: string[] = Array.isArray(raw.labelIds) ? raw.labelIds : [];
  if (labels.includes("DRAFT")) return null;

  const { name, email } = parseSender(String(raw.sender ?? raw.from ?? ""));
  const own = ownEmail.toLowerCase();
  const outbound = labels.includes("SENT") || (!!email && email === own);

  const rawBody = String(raw.messageText ?? raw.body ?? raw.snippet ?? "");
  const text = /<\/?[a-z][\s\S]*>/i.test(rawBody) ? htmlToText(rawBody) : rawBody;
  const body = stripQuoted(text) || text.trim();

  const ts = raw.messageTimestamp ?? raw.internalDate ?? raw.date;
  const parsed = typeof ts === "number" ? ts : Date.parse(String(ts ?? ""));
  return {
    id,
    threadId,
    fromName: name,
    fromEmail: email,
    subject: String(raw.subject ?? "").trim(),
    body,
    at: Number.isFinite(parsed) ? parsed : Date.now(),
    outbound,
  };
}
