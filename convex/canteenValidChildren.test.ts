import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { buildWorkbook } from "./canteenValidChildren";
import { buildChildren } from "./lib/canteenValidity";
import { scanCanteenRecon } from "./lib/parsers/canteenRecon";
import { parseCanteenDeviation } from "./lib/parsers/canteenDeviation";
import { canteenValidChildrenValidator } from "./validators/canteenValidChildren";

function sheetBuffer(rows: unknown[][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Payments");
  return XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

const RECON = [
  [null, "LUNCH - 05.10.2026", null, null, null, null, null, null],
  ["NO.", "NAME", "CLASS", "CASH", "AIRTEL", "WISE", "BANK", "MASTER"],
  [1, "Mary Banda", "1A", null, 35, null, null, null],
  [2, "Joy Phiri", "REC", 70, null, null, null, null],
  [3, "Peter Mwale", "2B", 20, null, 30, null, null],
  [null, "TOTAL", null, 90, 35, 30, null, null],
];

describe("scanCanteenRecon payments", () => {
  it("returns each paying child with name, class and the amount summed across methods", () => {
    const { payments, statement } = scanCanteenRecon(sheetBuffer(RECON));
    expect(statement.metadata?.date).toBe("2026-10-05");
    expect(payments).toEqual([
      { name: "Mary Banda", className: "1A", amount: 35 },
      { name: "Joy Phiri", className: "REC", amount: 70 },
      { name: "Peter Mwale", className: "2B", amount: 50 },
    ]);
  });
});

describe("valid children workbook", () => {
  it("round-trips through the summary parser and validator", async () => {
    const { payments } = scanCanteenRecon(sheetBuffer(RECON));
    const date = "2026-10-05";
    const children = buildChildren(payments.map((p) => ({ ...p, date })));
    const { buffer, summary } = buildWorkbook(children, date);

    expect(summary.validChildren).toBe(3);
    expect(summary.expiringToday).toBe(2); // Mary (1 day) and Peter (K50 rounds to 1 day)
    expect(summary.roundedPayments).toBe(1);

    const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
    expect(wb.SheetNames).toEqual(["Valid Children", "Just Expired", "Flags", "Summary"]);
    const list = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets["Valid Children"], { header: 1 });
    expect(list[3]?.[1]).toBe("Child");
    expect(list.slice(4).map((r) => r[1])).toEqual(["Mary Banda", "Peter Mwale", "Joy Phiri"]);

    const parsed = parseCanteenDeviation(buffer);
    expect(parsed.metadata?.validChildren).toBe(3);
    const result = await canteenValidChildrenValidator([{ statement: parsed } as never], []);
    expect(result.score).toBe(100);
  });
});
