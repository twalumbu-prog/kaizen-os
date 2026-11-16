import { describe, expect, it } from "vitest";
import { metaSignatureValid, parseMetaWebhook } from "./metaWebhook";

describe("parseMetaWebhook", () => {
  it("reads a WhatsApp text message", () => {
    const msgs = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "111" },
                contacts: [{ wa_id: "260971", profile: { name: "Chanda" } }],
                messages: [{ id: "wamid.1", from: "260971", timestamp: "1700000000", type: "text", text: { body: "Hi" } }],
              },
            },
          ],
        },
      ],
    });
    expect(msgs).toEqual([
      { channel: "whatsapp", accountExternalId: "111", contactId: "260971", contactName: "Chanda", messageId: "wamid.1", body: "Hi", at: 1_700_000_000_000 },
    ]);
  });

  it("labels non-text WhatsApp messages", () => {
    const [m] = parseMetaWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { metadata: { phone_number_id: "1" }, messages: [{ id: "a", from: "2", timestamp: "1", type: "image" }] } }] }],
    });
    expect(m.body).toBe("[image message]");
  });

  it("reads Messenger and Instagram messages and skips echoes", () => {
    const ev = (mid: string, echo = false) => ({ sender: { id: "u1" }, recipient: { id: "p1" }, timestamp: 5, message: { mid, text: "yo", is_echo: echo } });
    const fb = parseMetaWebhook({ object: "page", entry: [{ id: "p1", messaging: [ev("m1"), ev("m2", true)] }] });
    expect(fb).toHaveLength(1);
    expect(fb[0]).toMatchObject({ channel: "facebook", accountExternalId: "p1", contactId: "u1", messageId: "m1", body: "yo" });
    expect(parseMetaWebhook({ object: "instagram", entry: [{ id: "ig1", messaging: [ev("m3")] }] })[0].channel).toBe("instagram");
  });

  it("ignores junk", () => {
    expect(parseMetaWebhook(null)).toEqual([]);
    expect(parseMetaWebhook({ object: "page" })).toEqual([]);
  });
});

describe("metaSignatureValid", () => {
  it("accepts a correct HMAC and rejects a wrong one", async () => {
    const body = '{"a":1}';
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (b) => b.toString(16).padStart(2, "0")).join("");
    expect(await metaSignatureValid(body, `sha256=${sig}`, "secret")).toBe(true);
    expect(await metaSignatureValid(body, `sha256=${sig}`, "other")).toBe(false);
    expect(await metaSignatureValid(body, null, "secret")).toBe(false);
  });
});
