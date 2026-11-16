/** Reads Meta webhook payloads (WhatsApp Cloud API, Messenger, Instagram) into plain inbound messages. */

export type InboundMeta = {
  channel: "whatsapp" | "facebook" | "instagram";
  /** WhatsApp phone_number_id, Facebook Page id or Instagram business account id. */
  accountExternalId: string;
  contactId: string;
  contactName: string;
  messageId: string;
  body: string;
  at: number;
};

const isObj = (x: unknown): x is Record<string, any> => typeof x === "object" && x !== null;

export function parseMetaWebhook(payload: unknown): InboundMeta[] {
  if (!isObj(payload) || !Array.isArray(payload.entry)) return [];
  const out: InboundMeta[] = [];

  for (const entry of payload.entry) {
    if (!isObj(entry)) continue;

    if (payload.object === "whatsapp_business_account") {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        const value = change?.value;
        if (!isObj(value) || !isObj(value.metadata)) continue;
        const phoneNumberId = String(value.metadata.phone_number_id ?? "");
        if (!phoneNumberId) continue;
        const names = new Map<string, string>();
        for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
          if (c?.wa_id) names.set(String(c.wa_id), String(c.profile?.name ?? ""));
        }
        for (const m of Array.isArray(value.messages) ? value.messages : []) {
          if (!m?.id || !m?.from) continue;
          const from = String(m.from);
          const text = m.type === "text" ? String(m.text?.body ?? "") : m.type === "button" ? String(m.button?.text ?? "") : "";
          out.push({
            channel: "whatsapp",
            accountExternalId: phoneNumberId,
            contactId: from,
            contactName: names.get(from) || from,
            messageId: String(m.id),
            body: text || `[${String(m.type ?? "unsupported")} message]`,
            at: Number(m.timestamp) * 1000 || Date.now(),
          });
        }
      }
    } else if (payload.object === "page" || payload.object === "instagram") {
      const channel = payload.object === "page" ? "facebook" : "instagram";
      for (const ev of Array.isArray(entry.messaging) ? entry.messaging : []) {
        const msg = ev?.message;
        // Echoes are our own outgoing messages coming back.
        if (!isObj(msg) || msg.is_echo || !msg.mid || !ev.sender?.id) continue;
        out.push({
          channel,
          accountExternalId: String(entry.id ?? ev.recipient?.id ?? ""),
          contactId: String(ev.sender.id),
          contactName: String(ev.sender.id),
          messageId: String(msg.mid),
          body: typeof msg.text === "string" && msg.text ? msg.text : "[attachment]",
          at: Number(ev.timestamp) || Date.now(),
        });
      }
    }
  }
  return out.filter((m) => m.accountExternalId);
}

/** Meta signs the raw body: `X-Hub-Signature-256: sha256=<hex hmac>`. */
export async function metaSignatureValid(rawBody: string, header: string | null, appSecret: string): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const given = header.slice(7);
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}
