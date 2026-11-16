import { describe, expect, it } from "vitest";
import { parseDecision, pickAgent, type AgentLite } from "./agentDecision";

const agent = (o: Partial<AgentLite> & { _id: string }): AgentLite => ({
  name: "A",
  title: "Customer Service",
  instructions: "",
  model: "m",
  mode: "draft",
  channels: ["gmail"],
  isSupervisor: false,
  ...o,
});

describe("pickAgent", () => {
  it("keeps the current owner while it is still on for the channel", () => {
    const a = agent({ _id: "a" });
    const b = agent({ _id: "b" });
    expect(pickAgent([a, b], "gmail", "b")?._id).toBe("b");
  });

  it("falls back to the first active non-supervisor for the channel", () => {
    const off = agent({ _id: "off", mode: "off" });
    const sup = agent({ _id: "sup", isSupervisor: true });
    const wa = agent({ _id: "wa", channels: ["whatsapp"] });
    const ok = agent({ _id: "ok" });
    expect(pickAgent([off, sup, wa, ok], "gmail")?._id).toBe("ok");
  });

  it("returns null when nobody covers the channel", () => {
    expect(pickAgent([agent({ _id: "a", channels: ["whatsapp"] })], "instagram")).toBeNull();
  });
});

describe("parseDecision", () => {
  it("reads a reply", () => {
    const d = parseDecision('```json\n{"action":"reply","reply":" Hello ","labels":["Billing","x","y","z"],"reason":"ok"}\n```');
    expect(d).toEqual({ action: "reply", reply: "Hello", labels: ["billing", "x", "y"], reason: "ok" });
  });

  it("escalates unreadable output", () => {
    expect(parseDecision("sorry").action).toBe("escalate");
    expect(parseDecision('{"action":"explode"}').action).toBe("escalate");
  });

  it("escalates an empty reply instead of sending nothing", () => {
    expect(parseDecision('{"action":"reply","reply":"  "}').action).toBe("escalate");
  });

  it("drops reply text on non-reply actions", () => {
    expect(parseDecision('{"action":"ignore","reply":"hi"}').reply).toBe("");
  });
});
