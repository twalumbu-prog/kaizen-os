import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

/**
 * Parses the workbook produced by the canteen deviation automation.
 * The "Summary" sheet is a two-column key/value list for the report's date:
 * date, expectedChildren, actualChildren, deviation, kwachaImpact,
 * salesReconStudents, reconMinusInventory.
 */
export function parseCanteenDeviation(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const ws = wb.Sheets["Summary"];
  const metadata: Record<string, string | number | null> = {};
  if (ws) {
    const rows: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    for (const row of rows) {
      const key = typeof row[0] === "string" ? row[0].trim() : "";
      const val = row[1];
      if (!key) continue;
      if (typeof val === "number" || typeof val === "string") metadata[key] = val;
      else metadata[key] = null;
    }
  }
  metadata.hasSummary = ws ? 1 : 0;
  return { openingBalance: null, closingBalance: null, transactions: [], metadata };
}
