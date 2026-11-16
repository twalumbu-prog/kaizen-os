import { describe, expect, it } from "vitest";
import { parseGmailMessage, parseSender, stripQuoted } from "./gmailParse";

describe("parseSender", () => {
  it("splits name and address", () => {
    expect(parseSender('"Jane Doe" <Jane@Example.com>')).toEqual({ name: "Jane Doe", email: "jane@example.com" });
    expect(parseSender("bob@x.org")).toEqual({ name: "", email: "bob@x.org" });
  });
});

describe("stripQuoted", () => {
  it("keeps only the new text of a reply", () => {
    const t = "Thanks, see you then.\n\nOn Mon, 3 Nov 2026 at 10:00, Sam <s@x.com> wrote:\n> earlier text";
    expect(stripQuoted(t)).toBe("Thanks, see you then.");
  });
});

describe("parseGmailMessage", () => {
  const base = { messageId: "m1", threadId: "t1", sender: "Ann <ann@x.com>", subject: "Hi", messageText: "Hello there", messageTimestamp: "2026-11-01T10:00:00Z" };

  it("parses an inbound email", () => {
    const m = parseGmailMessage(base, "me@org.com")!;
    expect(m).toMatchObject({ id: "m1", threadId: "t1", fromEmail: "ann@x.com", outbound: false, body: "Hello there" });
    expect(m.at).toBe(Date.parse("2026-11-01T10:00:00Z"));
  });

  it("flags mail from the connected mailbox as outbound", () => {
    expect(parseGmailMessage({ ...base, sender: "Me <me@org.com>" }, "me@org.com")!.outbound).toBe(true);
    expect(parseGmailMessage({ ...base, labelIds: ["SENT"] }, "me@org.com")!.outbound).toBe(true);
  });

  it("skips drafts and messages without ids", () => {
    expect(parseGmailMessage({ ...base, labelIds: ["DRAFT"] }, "me@org.com")).toBeNull();
    expect(parseGmailMessage({ subject: "x" }, "me@org.com")).toBeNull();
  });

  it("converts HTML bodies to text", () => {
    expect(parseGmailMessage({ ...base, messageText: "<p>Hi<br>there</p>" }, "me@org.com")!.body).toBe("Hi\nthere");
  });
});
