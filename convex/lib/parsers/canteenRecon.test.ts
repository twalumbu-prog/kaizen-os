import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseCanteenRecon } from "./canteenRecon";

function buildWorkbookBuffer(rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Payments");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

/** Mirrors the real sheet's shape: title row with an embedded date, 8-column
 * header, numbered student rows, and a TOTAL row — with anonymised names. */
const REAL_SHAPE_ROWS: unknown[][] = [
  [null, "LUNCH - 07.09.2026", null, null, null, null, null, null],
  ["NO.", "NAME", "CLASS", "CASH", "AIRTEL", "WISE", "BANK", "MASTER"],
  [1, "STUDENT A", "BABY", null, 35, null, null, null],
  [2, "STUDENT B", "MIDDLE", 70, null, null, null, null],
  [3, "STUDENT C", "MIDDLE", null, null, null, null, 140],
  [4, "STUDENT D", "REC", null, null, 560, null, null],
  [5, "STUDENT E", "1A", null, null, null, 350, null],
  [null, "TOTAL", null, 70, 35, 560, 350, 140],
];

describe("parseCanteenRecon", () => {
  it("reads the date from the title row when there is no labeled Date field", () => {
    const statement = parseCanteenRecon(buildWorkbookBuffer(REAL_SHAPE_ROWS));
    expect(statement.metadata?.date).toBe("2026-09-07");
  });

  it("maps each payment method by its header label, not a fixed column position", () => {
    const statement = parseCanteenRecon(buildWorkbookBuffer(REAL_SHAPE_ROWS));
    expect(statement.metadata?.cashTotal).toBe(70);
    expect(statement.metadata?.airtelTotal).toBe(35);
    expect(statement.metadata?.wiseTotal).toBe(560);
    expect(statement.metadata?.bankTotal).toBe(350);
    expect(statement.metadata?.masterTotal).toBe(140);
  });

  it("re-sums each column from the individual student rows", () => {
    const statement = parseCanteenRecon(buildWorkbookBuffer(REAL_SHAPE_ROWS));
    expect(statement.metadata?.cashSum).toBe(70);
    expect(statement.metadata?.airtelSum).toBe(35);
    expect(statement.metadata?.wiseSum).toBe(560);
    expect(statement.metadata?.bankSum).toBe(350);
    expect(statement.metadata?.masterSum).toBe(140);
  });

  it("counts every numbered row as a student", () => {
    const statement = parseCanteenRecon(buildWorkbookBuffer(REAL_SHAPE_ROWS));
    expect(statement.metadata?.studentCount).toBe(5);
  });

  it("finds the TOTAL row even when the label sits in column B, not column A", () => {
    const rows = REAL_SHAPE_ROWS.map((row) => [...row]);
    // Already exercised above (label is in col B); this pins that behaviour
    // explicitly against regressing back to requiring col A.
    const totalRow = rows[rows.length - 1];
    expect(totalRow[0]).toBeNull();
    expect(totalRow[1]).toBe("TOTAL");
    const statement = parseCanteenRecon(buildWorkbookBuffer(rows));
    expect(statement.metadata?.cashTotal).not.toBeNull();
  });

  it("still recognises a column reordered from the usual layout", () => {
    const reordered: unknown[][] = [
      [null, "LUNCH - 10.09.2026", null, null, null, null, null, null],
      ["NO.", "NAME", "CLASS", "AIRTEL", "CASH", "MASTER", "BANK", "WISE"],
      [1, "STUDENT A", "BABY", 35, null, null, null, null],
      [null, "TOTAL", null, 35, 0, 0, 0, 0],
    ];
    const statement = parseCanteenRecon(buildWorkbookBuffer(reordered));
    expect(statement.metadata?.airtelTotal).toBe(35);
    expect(statement.metadata?.cashTotal).toBe(0);
  });

  it("treats a payment method absent from the header as null rather than zero", () => {
    const noWise: unknown[][] = [
      [null, "LUNCH - 07.09.2026", null, null, null, null, null],
      ["NO.", "NAME", "CLASS", "CASH", "AIRTEL", "BANK", "MASTER"],
      [1, "STUDENT A", "BABY", 70, null, null, null],
      [null, "TOTAL", null, 70, 0, 0, 0],
    ];
    const statement = parseCanteenRecon(buildWorkbookBuffer(noWise));
    expect(statement.metadata?.wiseTotal).toBeNull();
    expect(statement.metadata?.wiseSum).toBeNull();
  });

  it("still supports the older Date:/Grand Total/AMT Deposited labeled layout", () => {
    const legacy: unknown[][] = [
      ["Date:", "2026-09-07", null, "Prepared by:", "Jane Doe"],
      ["NO.", "NAME", "CLASS", "CASH", "AIRTEL", "MASTER"],
      [1, "STUDENT A", "BABY", 70, null, null],
      ["Total", null, null, 70, 0, 0],
      ["Grand Total", 70],
      ["AMT Deposited", 70],
    ];
    const statement = parseCanteenRecon(buildWorkbookBuffer(legacy));
    expect(statement.metadata?.date).toBe("2026-09-07");
    expect(statement.metadata?.preparedBy).toBe("Jane Doe");
    expect(statement.metadata?.grandTotal).toBe(70);
    expect(statement.metadata?.amtDeposited).toBe(70);
  });
});
