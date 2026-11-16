import { describe, expect, it } from "vitest";
import { avatarColor, initialsOf } from "../../lib/inbox-ui";

describe("initialsOf", () => {
  it("uses the first letters of the first two words", () => {
    expect(initialsOf("Stephen Kapambwe")).toBe("SK");
    expect(initialsOf("ash.grove_co")).toBe("AG");
    expect(initialsOf("Mary Jane Watson")).toBe("MJ");
  });
  it("uses two letters of a single word and the start of an email", () => {
    expect(initialsOf("Chanda")).toBe("CH");
    expect(initialsOf("", "bob.smith@example.com")).toBe("BS");
  });
  it("falls back to # when there are no letters (e.g. a phone number)", () => {
    expect(initialsOf("260971234567", "260971234567")).toBe("#");
  });
});

describe("avatarColor", () => {
  it("is stable for the same key", () => {
    expect(avatarColor("260971234567")).toEqual(avatarColor("260971234567"));
  });
});
