import * as XLSX from "xlsx";
import type { ParsedStatement } from "../../validators/types";

const REQUIRED_COL_HINTS = ["date", "ad", "format", "platform", "view", "engagement", "click", "ctr"];

export interface AdRow {
  date: string;
  adName: string;
  format: string;
  platform: string;
  views: number;
  engagements: number;
  linkClicks: number;
  ctr: number;
  engagementRate: number;
  conversionRate: number;
}

export function parseAdPerformance(buffer: ArrayBuffer): ParsedStatement {
  const wb = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  if (raw.length === 0) {
    return { openingBalance: null, closingBalance: null, transactions: [], metadata: { hasRequiredColumns: 0, rowCount: 0 } };
  }

  const header = (raw[0] as unknown[]).map((h) => String(h ?? "").toLowerCase().trim());

  const hasRequiredColumns = REQUIRED_COL_HINTS.every((hint) =>
    header.some((h) => h.includes(hint)),
  );

  // Find column indices by substring match.
  const col = (...hints: string[]) =>
    header.findIndex((h) => hints.some((hint) => h.includes(hint)));

  const iDate       = col("date");
  const iAdName     = col("ad name", "ad", "name");
  const iFormat     = col("format");
  const iPlatform   = col("platform");
  const iViews      = col("views", "impression");
  const iEngagement = col("engagements", "engagement");
  const iLinkClicks = col("link clicks", "link click", "clicks");
  const iCtr        = col("ctr");
  const iEngRate    = col("engagement rate");
  const iConvRate   = col("conversion rate", "conversion");

  const adRows: AdRow[] = [];
  for (const row of raw.slice(1)) {
    const r = row as unknown[];
    const rawDate = r[iDate];
    const date =
      rawDate instanceof Date
        ? rawDate.toISOString().slice(0, 10)
        : String(rawDate ?? "").trim();
    if (!date) continue;

    adRows.push({
      date,
      adName:         String(r[iAdName]     ?? "").trim(),
      format:         String(r[iFormat]     ?? "").trim(),
      platform:       String(r[iPlatform]   ?? "").trim(),
      views:          Number(r[iViews])      || 0,
      engagements:    Number(r[iEngagement]) || 0,
      linkClicks:     Number(r[iLinkClicks]) || 0,
      ctr:            Number(r[iCtr])        || 0,
      engagementRate: Number(r[iEngRate])    || 0,
      conversionRate: Number(r[iConvRate])   || 0,
    });
  }

  return {
    openingBalance: null,
    closingBalance: null,
    transactions: adRows.map((ad) => ({
      date: ad.date,
      description: `${ad.adName} | ${ad.platform}`,
      amount: ad.views,
      type: "credit" as const,
    })),
    metadata: {
      hasRequiredColumns: hasRequiredColumns ? 1 : 0,
      rowCount: adRows.length,
      rows: JSON.stringify(adRows),
    },
  };
}
