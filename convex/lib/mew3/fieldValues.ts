/**
 * Boils a document's rows down to one value per configured "AI Data Extraction
 * Field", for the Extracted Metrics & Figures panel: amounts are totalled,
 * everything else lists the distinct values read, in order.
 */
export function fieldValues(
  rows: Array<Record<string, unknown>>,
  fields: Array<{ key: string }>,
): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const { key } of fields) {
    const values = rows
      .map((r) => {
        const extra = r.extra && typeof r.extra === "object" ? (r.extra as Record<string, unknown>)[key] : undefined;
        return r[key] ?? extra;
      })
      .filter((v) => v !== null && v !== undefined && v !== "");
    if (!values.length) {
      out[key] = null;
    } else if (key === "amount" && values.every((v) => typeof v === "number")) {
      out[key] = Math.round((values as number[]).reduce((a, b) => a + b, 0) * 100) / 100;
    } else {
      const text = [...new Set(values.map(String))].join("; ");
      out[key] = text.length > 400 ? `${text.slice(0, 397)}…` : text;
    }
  }
  return out;
}
