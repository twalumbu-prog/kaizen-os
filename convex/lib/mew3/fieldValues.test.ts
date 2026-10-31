import { describe, expect, it } from "vitest";
import { fieldValues } from "./fieldValues";

describe("fieldValues", () => {
  it("totals amounts and lists distinct text, including extra columns", () => {
    const rows = [
      { guestName: "Ngwanza BB", amount: 1300, nationality: "Congolese", extra: { vehicle: "ABC 123" } },
      { guestName: "Jonathan", amount: 500, nationality: "Congolese", extra: { vehicle: null } },
    ];
    expect(fieldValues(rows, [{ key: "guestName" }, { key: "amount" }, { key: "nationality" }, { key: "vehicle" }, { key: "email" }])).toEqual({
      guestName: "Ngwanza BB; Jonathan",
      amount: 1800,
      nationality: "Congolese",
      vehicle: "ABC 123",
      email: null,
    });
  });
});
