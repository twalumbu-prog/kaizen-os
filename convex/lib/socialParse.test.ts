import { describe, expect, it } from "vitest";
import { extractList, inboundMessages, otherParticipant } from "./socialParse";

describe("extractList", () => {
  it("finds lists at the usual depths", () => {
    expect(extractList({ data: [{ id: "1" }] })).toHaveLength(1);
    expect(extractList({ response_data: { data: [{ id: "1" }, { id: "2" }] } })).toHaveLength(2);
    expect(extractList([{ id: "1" }])).toHaveLength(1);
    expect(extractList(null)).toEqual([]);
  });
});

describe("otherParticipant", () => {
  it("returns the contact, not our own page", () => {
    const conv = { participants: { data: [{ id: "page", name: "Us" }, { id: "u1", name: "Ann" }] } };
    expect(otherParticipant(conv, "page")).toEqual({ id: "u1", name: "Ann" });
    expect(otherParticipant({}, "page")).toBeNull();
  });
});

describe("inboundMessages", () => {
  it("keeps only contact messages, oldest first", () => {
    const out = inboundMessages(
      { data: [
        { id: "m2", message: "later", from: { id: "u1", name: "Ann" }, created_time: "2026-11-02T10:00:00Z" },
        { id: "m1", message: "first", from: { id: "u1", name: "Ann" }, created_time: "2026-11-01T10:00:00Z" },
        { id: "m3", message: "ours", from: { id: "page" }, created_time: "2026-11-02T11:00:00Z" },
        { id: "m4", message: "", from: { id: "u1" }, created_time: "2026-11-02T12:00:00Z" },
      ] },
      "page",
    );
    expect(out.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
