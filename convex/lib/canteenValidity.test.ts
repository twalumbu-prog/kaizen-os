import { describe, expect, it } from "vitest";
import {
  buildChildren,
  dateOfSchoolDay,
  datesToReport,
  daysForAmount,
  isSchoolDay,
  justExpiredOn,
  nameCost,
  nameTokens,
  schoolDayIndex,
  validOn,
  type Payment,
} from "./canteenValidity";

// 2026-10-05 is a Monday.
const MON = "2026-10-05";
const TUE = "2026-10-06";
const WED = "2026-10-07";
const THU = "2026-10-08";
const FRI = "2026-10-09";
const NEXT_MON = "2026-10-12";
const NEXT_TUE = "2026-10-13";

const pay = (date: string, name: string, amount: number, className = "1A"): Payment => ({ date, name, className, amount });
const names = (list: Array<{ name: string }>) => list.map((c) => c.name);

describe("school-day calendar", () => {
  it("counts Mon–Thu only and round-trips", () => {
    expect([MON, TUE, WED, THU].every(isSchoolDay)).toBe(true);
    expect(isSchoolDay(FRI)).toBe(false);
    expect(schoolDayIndex(NEXT_MON)).toBe(schoolDayIndex(THU) + 1);
    expect(schoolDayIndex(FRI)).toBe(schoolDayIndex(NEXT_MON));
    expect(dateOfSchoolDay(schoolDayIndex(WED))).toBe(WED);
  });
});

describe("daysForAmount", () => {
  it("is exact for multiples of the rate and rounds (flagged) otherwise", () => {
    expect(daysForAmount(70)).toEqual({ days: 2, rounded: false });
    expect(daysForAmount(140)).toEqual({ days: 4, rounded: false });
    expect(daysForAmount(50)).toEqual({ days: 1, rounded: true });
    expect(daysForAmount(100)).toEqual({ days: 3, rounded: true });
    expect(daysForAmount(10)).toEqual({ days: 1, rounded: true });
  });
});

describe("validity", () => {
  it("counts the payment day, so a 1-day payer eats only that day", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 35)]);
    expect(names(validOn(kids, MON))).toEqual(["Mary Banda"]);
    expect(validOn(kids, MON)[0].daysAfter).toBe(0);
    expect(validOn(kids, TUE)).toEqual([]);
  });

  it("a 2-day payer is valid on the payment day and the next", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 70)]);
    expect(validOn(kids, MON)[0].daysAfter).toBe(1);
    expect(validOn(kids, TUE)[0].daysAfter).toBe(0);
    expect(validOn(kids, TUE)[0].lastValidDay).toBe(TUE);
    expect(validOn(kids, WED)).toEqual([]);
  });

  it("skips Friday–Sunday: a week (4 days) paid Tuesday runs to next Monday", () => {
    const kids = buildChildren([pay(TUE, "Mary Banda", 140)]);
    expect(validOn(kids, THU)).toHaveLength(1);
    expect(validOn(kids, FRI)).toEqual([]); // not a school day, nothing to eat
    expect(validOn(kids, NEXT_MON)[0].daysAfter).toBe(0);
    expect(validOn(kids, NEXT_MON)[0].lastValidDay).toBe(NEXT_MON);
    expect(validOn(kids, NEXT_TUE)).toEqual([]);
  });

  it("queues an early top-up after the days already paid for", () => {
    // 3 days from Monday (Mon–Wed); pays 3 more on Monday → Thu, Mon, Tue.
    const kids = buildChildren([pay(MON, "Mary Banda", 105), pay(MON, "Mary Banda", 105)]);
    expect(validOn(kids, WED)[0].daysAfter).toBe(3);
    expect(validOn(kids, THU)[0].daysAfter).toBe(2);
    expect(validOn(kids, NEXT_TUE)[0].daysAfter).toBe(0);
    expect(validOn(kids, NEXT_TUE)[0].lastValidDay).toBe(NEXT_TUE);
  });

  it("ignores payments made after the day being reported", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 35), pay(WED, "Mary Banda", 35)]);
    expect(validOn(kids, TUE)).toEqual([]);
    expect(validOn(kids, WED)).toHaveLength(1);
  });

  it("starts a late payment from its own day, not from the old expiry", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 35), pay(WED, "Mary Banda", 70)]);
    expect(validOn(kids, WED)[0].daysAfter).toBe(1);
    expect(validOn(kids, THU)[0].daysAfter).toBe(0);
  });

  it("reports who has just expired", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 35), pay(MON, "Joy Phiri", 70)]);
    expect(names(justExpiredOn(kids, TUE))).toEqual(["Mary Banda"]);
    expect(justExpiredOn(kids, WED).map((c) => c.name)).toEqual(["Joy Phiri"]);
  });

  it("rounds odd amounts to the closest day and flags the payment", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 50)]);
    const [c] = validOn(kids, MON);
    expect(c.paidToday).toEqual({ amount: 50, days: 1, rounded: true });
  });

  it("sorts the children closest to expiry first", () => {
    const kids = buildChildren([pay(MON, "Zed Mwale", 140), pay(MON, "Amy Zulu", 35)]);
    expect(names(validOn(kids, MON))).toEqual(["Amy Zulu", "Zed Mwale"]);
  });
});

describe("loose name matching", () => {
  it("ignores word order, case and punctuation", () => {
    expect(nameCost(nameTokens("Banda, Mary"), nameTokens("MARY BANDA"))).toBe(0);
  });

  it("forgives a typo in a long word and a missing middle name", () => {
    expect(nameCost(nameTokens("Mary Bandaa"), nameTokens("Mary Banda"))).not.toBeNull();
    expect(nameCost(nameTokens("Mary Chanda Banda"), nameTokens("Mary Banda"))).not.toBeNull();
  });

  it("does not match different people or lone first names", () => {
    expect(nameCost(nameTokens("Mary Banda"), nameTokens("Mercy Banda"))).toBeNull();
    expect(nameCost(nameTokens("Mary"), nameTokens("Mary Banda"))).toBeNull();
  });

  it("merges spelling variants into one child and keeps the alias", () => {
    const kids = buildChildren([pay(MON, "Mary Banda", 35), pay(TUE, "BANDA MARY", 35), pay(WED, "Mary Bandaa", 35)]);
    expect(kids).toHaveLength(1);
    expect([...kids[0].aliases].sort()).toEqual(["BANDA MARY", "Mary Bandaa"]);
    expect(validOn(kids, WED)).toHaveLength(1);
  });

  it("keeps similarly named children in different classes apart", () => {
    const kids = buildChildren([pay(MON, "John Banda", 35, "1A"), pay(MON, "Jon Banda", 35, "5B")]);
    expect(kids).toHaveLength(2);
  });

  it("does not guess between two equally close candidates", () => {
    const kids = buildChildren([
      pay(MON, "Maria Zulu", 35, "1A"),
      pay(MON, "Mariam Zulu", 35, "2B"),
      pay(TUE, "Mariah Zulu", 35, ""),
    ]);
    expect(kids).toHaveLength(3);
    expect(kids[2].notes).toHaveLength(2);
  });
});

describe("datesToReport", () => {
  const recon = (entries: Array<[string, number]>) => new Map(entries);

  it("reports every school day that has no report yet", () => {
    expect(datesToReport(recon([[MON, 10], [TUE, 20]]), new Map())).toEqual([MON, TUE]);
  });

  it("leaves a day alone once its report is newer than every recon up to it", () => {
    expect(datesToReport(recon([[MON, 10], [TUE, 20]]), new Map([[MON, 15], [TUE, 25]]))).toEqual([]);
  });

  it("does not redo earlier days when a later recon arrives", () => {
    expect(datesToReport(recon([[MON, 10], [TUE, 30]]), new Map([[MON, 15]]))).toEqual([TUE]);
  });

  it("redoes a day and every later day when an earlier recon is corrected", () => {
    const reports = new Map([[MON, 15], [TUE, 25], [WED, 35]]);
    expect(datesToReport(recon([[MON, 40], [TUE, 20], [WED, 30]]), reports)).toEqual([MON, TUE, WED]);
  });

  it("skips non-school days", () => {
    expect(datesToReport(recon([[FRI, 10]]), new Map())).toEqual([]);
  });
});
