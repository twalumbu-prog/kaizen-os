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
    expect(otherParticipant(conv, { ids: ["page"] })).toEqual({ id: "u1", name: "Ann" });
    expect(otherParticipant({}, { ids: ["page"] })).toBeNull();
  });
});

describe("Instagram's two ids for our own account", () => {
  it("recognises our account by username when the ids differ", () => {
    const own = { ids: ["27994"], username: "blueopus" };
    const conv = { participants: { data: [{ id: "17841", username: "blueopus" }, { id: "111", username: "ash" }] } };
    expect(otherParticipant(conv, own)).toEqual({ id: "111", name: "ash" });
    const msgs = inboundMessages(
      { data: [
        { id: "a", message: "hi", from: { id: "111", username: "ash" }, created_time: "2026-11-01T10:00:00Z" },
        { id: "b", message: "reply", from: { id: "17841", username: "blueopus" }, created_time: "2026-11-01T11:00:00Z" },
      ] },
      own,
    );
    expect(msgs.map((m) => m.id)).toEqual(["a"]);
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
      { ids: ["page"] },
    );
    expect(out.map((m) => m.id)).toEqual(["m1", "m2"]);
  });
});
