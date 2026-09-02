import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

/**
 * Parses the Canteen Ingredients Inventory Tracker spreadsheet.
 *
 * Expected layout (labels searched, not hard-coded row indices):
 *   Title row: "CANTEEN INGREDIENTS INVENTORY TRACKER" somewhere in row 1
 *   Info row:  [..., "Week No.", <n>, "Date:", <date>, "Name of Meal:", <meal>, "Prepared by:", <name>, ...]
 *   Ingredient header row and data rows follow.
 *   A row where col B contains "How Many Children Ate on This Day?" holds the
 *   children count in the "Cost Per Child" column (the 9th column, index 8).
 *
 * Metadata keys produced (consumed by canteenSalesRecon validator):
 *   date, mealName, preparedBy, childrenAte
 */
export function parseCanteenInventory(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  const toDateStr = (val: unknown): string | null => {
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    if (!val) return null;
    const raw = String(val).trim();
    const slash = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (slash) {
      const [, a, b, y] = slash;
      const year = y.length === 2 ? `20${y}` : y;
      const day = a.padStart(2, "0");
      const month = b.padStart(2, "0");
      if (Number(month) <= 12 && Number(day) <= 31)
        return `${year}-${month}-${day}`;
    }
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  };

  let date: string | null = null;
  let mealName: string | null = null;
  let preparedBy: string | null = null;
  let childrenAte: number | null = null;

  for (const row of rows) {
    // Scan every cell in the row looking for known label tokens.
    for (let i = 0; i < row.length; i++) {
      const cell = String(row[i] ?? "").trim();

      if (/^date:?$/i.test(cell) && date === null) {
        date = toDateStr(row[i + 1]);
      }
      if (/^name of meal:?$/i.test(cell) && mealName === null) {
        mealName = String(row[i + 1] ?? "").trim() || null;
      }
      if (/^prepared by:?$/i.test(cell) && preparedBy === null) {
        preparedBy = String(row[i + 1] ?? "").trim() || null;
      }
    }

    // "How Many Children Ate on This Day?" sits in the first data column of its
    // row (col B in the sheet = index 0 after XLSX strips the empty leading col A).
    // The count lives in the Cost Per Child column (col I = index 7 after shift).
    const col0 = String(row[0] ?? "").trim();
    if (/how many children ate/i.test(col0)) {
      // Try index 7 first (confirmed column position); fall back to any numeric
      // cell in the row in case the layout ever shifts.
      const candidate = row[7];
      if (typeof candidate === "number") {
        childrenAte = candidate;
      } else {
        for (let i = 1; i < row.length; i++) {
          const n = typeof row[i] === "number" ? (row[i] as number) : parseFloat(String(row[i] ?? ""));
          if (Number.isFinite(n)) { childrenAte = n; break; }
        }
      }
    }
  }

  return {
    openingBalance: null,
    closingBalance: null,
    transactions: [],
    metadata: { date, mealName, preparedBy, childrenAte },
  };
}
