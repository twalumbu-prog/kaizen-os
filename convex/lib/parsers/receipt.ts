import type { ParsedStatement } from "../../validators/types";

/**
 * Structured data extracted from a statutory payment receipt PDF.
 * Stored in ParsedStatement.metadata so the statutoryReceipts validator can read it
 * without any changes to the ParsedFile / ParsedStatement wire type.
 */
export interface ReceiptData {
  entityType: "ZRA_PAYE" | "NAPSA" | "NHIMA" | "UNKNOWN";
  /** ISO date string (yyyy-mm-dd) the payment was made. */
  paymentDate: string | null;
  /** ISO year-month string (yyyy-MM) the payment covers, e.g. "2025-07". */
  coveragePeriod: string | null;
  /** Payment amount in ZMW. */
  amount: number | null;
  /** Official receipt / reference number from the agency. */
  receiptNumber: string | null;
  /** Raw extracted text, stored for debugging. */
  rawText: string;
}

// ─── ZRA PAYE patterns ───────────────────────────────────────────────────────

const ZRA_ENTITY_MARKER = /Pay As You Earn|PAYE|Zambia Revenue Authority|ZRA/i;

/** "Payment Date: 2025-08-10 00:00:00.0" → "2025-08-10" — works when the PDF
 * text keeps the label and its value adjacent. */
const ZRA_PAYMENT_DATE = /Payment Date:\s*(\d{4}-\d{2}-\d{2})/i;

/**
 * Fallback for the real ZRA "Payment Receipt" export, whose layout separates
 * every label from its value (all labels extracted first, then all values, in
 * matching order) — so the regex above never finds an adjacent match. Payment
 * Date is the only date on the receipt formatted as a pure calendar date, at
 * midnight ("00:00:00") — Processed Date always carries a real time-of-day —
 * which distinguishes it without depending on label/value adjacency at all.
 */
const ZRA_PAYMENT_DATE_ZEROED_TIME = /(\d{4}-\d{2}-\d{2})\s+00:00:00/;

/**
 * Table row: "Pay As You Earn  PAY ...  01/07/2025  31/07/2025  1,351.13"
 * We capture the Period Start date (DD/MM/YYYY) to derive the coverage month.
 */
const ZRA_PERIOD_START = /\b(\d{2})\/(\d{2})\/(\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+([\d,]+\.\d+)/;

/** "Receipt No. 212510600090" */
const ZRA_RECEIPT_NO = /Receipt No\.?\s*(\w+)/i;

// ─── NAPSA patterns ───────────────────────────────────────────────────────────

const NAPSA_ENTITY_MARKER = /NATIONAL PENSION SCHEME AUTHORITY|NAPSA/i;

/** "Receipt Date: 2025-08-12" → "2025-08-12" — the ISO-formatted style. */
const NAPSA_RECEIPT_DATE = /Receipt Date:\s*(\d{4}-\d{2}-\d{2})/i;

/**
 * The real NAPSA "Contribution/Penalty Receipt" export instead writes
 * "Receipted Date: 07 SEPT 2026" — a different label ("Receipted", not
 * "Receipt") and a day/month-name/year format, not ISO.
 */
const NAPSA_RECEIPT_DATE_TEXT = /Receipted?\s*Date:\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/i;

const MONTH_NUMBER: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

/** "SEPT" / "Sep" / "September" → "09". NAPSA's own abbreviation is 4 letters, not the usual 3. */
export function monthNameToNumber(raw: string): string | null {
  const lower = raw.toLowerCase();
  return MONTH_NUMBER[lower] ?? MONTH_NUMBER[lower.slice(0, 3)] ?? null;
}

/**
 * Data row: "8/2026  <refNo>  9,629.5  0  9,629.5" — month/year (not
 * year/month), month not zero-padded. The long all-digit reference number is
 * required immediately after so this can't also match an unrelated DD/MM/YYYY
 * date elsewhere on the receipt (e.g. "Date printed: 07/09/2026").
 */
const NAPSA_PERIOD_ROW = /\b(\d{1,2})\/(\d{4})\s+(\d{5,})\s+([\d,]+\.?\d*)/;

/** "Receipt Number: 202958455" */
const NAPSA_RECEIPT_NO = /Receipt Number:\s*(\w+)/i;

const NHIMA_ENTITY_MARKER = /National\s+Health\s+Insurance\s+Management\s+Authority/i;

// ─── Parsers ─────────────────────────────────────────────────────────────────

function toNumber(raw: string): number {
  return parseFloat(raw.replace(/,/g, ""));
}

function zeroPad(n: string | number): string {
  return String(n).padStart(2, "0");
}

// ─── Parsers ─────────────────────────────────────────────────────────────────

export function parseZraPaye(text: string): ReceiptData {
  const paymentDateMatch = text.match(ZRA_PAYMENT_DATE) ?? text.match(ZRA_PAYMENT_DATE_ZEROED_TIME);
  const paymentDate = paymentDateMatch ? paymentDateMatch[1] : null;

  let coveragePeriod: string | null = null;
  let amount: number | null = null;
  const periodMatch = text.match(ZRA_PERIOD_START);
  if (periodMatch) {
    // periodMatch[1]=day, [2]=month, [3]=year, [4]=amount
    const [, , month, year, amtRaw] = periodMatch;
    coveragePeriod = `${year}-${zeroPad(month)}`;
    amount = toNumber(amtRaw);
  }

  const receiptMatch = text.match(ZRA_RECEIPT_NO);
  const receiptNumber = receiptMatch ? receiptMatch[1] : null;

  return { entityType: "ZRA_PAYE", paymentDate, coveragePeriod, amount, receiptNumber, rawText: text };
}

export function parseNapsa(text: string): ReceiptData {
  let paymentDate: string | null = null;
  const isoMatch = text.match(NAPSA_RECEIPT_DATE);
  if (isoMatch) {
    paymentDate = isoMatch[1];
  } else {
    const textMatch = text.match(NAPSA_RECEIPT_DATE_TEXT);
    if (textMatch) {
      const [, day, monthName, year] = textMatch;
      const month = monthNameToNumber(monthName);
      if (month) paymentDate = `${year}-${month}-${zeroPad(day)}`;
    }
  }

  let coveragePeriod: string | null = null;
  let amount: number | null = null;
  const periodMatch = text.match(NAPSA_PERIOD_ROW);
  if (periodMatch) {
    const [, month, year, , amtRaw] = periodMatch;
    coveragePeriod = `${year}-${zeroPad(month)}`;
    amount = toNumber(amtRaw);
  }

  const receiptMatch = text.match(NAPSA_RECEIPT_NO);
  const receiptNumber = receiptMatch ? receiptMatch[1] : null;

  return { entityType: "NAPSA", paymentDate, coveragePeriod, amount, receiptNumber, rawText: text };
}

export function parseNhima(text: string): ReceiptData {
  const dateMatch = text.match(/Date Generated\s*:\s*(\d{4}-\d{2}-\d{2})/i);
  const paymentDate = dateMatch ? dateMatch[1] : null;

  const refMatch = text.match(/Payment reference\s*:\s*([A-Za-z0-9]+)/i);
  const receiptNumber = refMatch ? refMatch[1] : null;

  const periodAmountMatch = text.match(/(\d{4})\s*-\s*(\d{1,2})\s+(?:[\d,.]+\s+[\d,.]+\s+)?([\d,.]+)/);
  let coveragePeriod: string | null = null;
  let amount: number | null = null;
  
  if (periodAmountMatch) {
    const year = periodAmountMatch[1];
    const month = periodAmountMatch[2].padStart(2, "0");
    coveragePeriod = `${year}-${month}`;
    amount = parseFloat(periodAmountMatch[3].replace(/,/g, ""));
  }

  return { entityType: "NHIMA", paymentDate, coveragePeriod, amount, receiptNumber, rawText: text };
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Parses a statutory payment receipt PDF (ZRA PAYE or NAPSA) and returns a
 * ParsedStatement whose `metadata` carries the extracted ReceiptData fields.
 * openingBalance / closingBalance / transactions are not meaningful for receipts
 * and are set to null / [].
 */
export async function parseReceiptPdf(buffer: ArrayBuffer): Promise<ParsedStatement> {
  // pdf-parse is a Node-only dep; dynamic import keeps it out of the V8 isolate.
  if (typeof global !== "undefined") {
    if (typeof global.DOMMatrix === "undefined") (global as any).DOMMatrix = class DOMMatrix {};
    if (typeof global.ImageData === "undefined") (global as any).ImageData = class ImageData {};
    if (typeof global.Path2D === "undefined") (global as any).Path2D = class Path2D {};
  }
  
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  const { text } = await parser.getText();
  await parser.destroy();

  let receipt: ReceiptData;
  if (NHIMA_ENTITY_MARKER.test(text)) {
    receipt = parseNhima(text);
  } else if (NAPSA_ENTITY_MARKER.test(text)) {
    receipt = parseNapsa(text);
  } else if (ZRA_ENTITY_MARKER.test(text)) {
    receipt = parseZraPaye(text);
  } else {
    receipt = { entityType: "UNKNOWN", paymentDate: null, coveragePeriod: null, amount: null, receiptNumber: null, rawText: text };
  }

  // Flatten ReceiptData into the metadata Record so it survives the ParsedFile boundary.
  const metadata: Record<string, string | number | null> = {
    entityType: receipt.entityType,
    paymentDate: receipt.paymentDate,
    coveragePeriod: receipt.coveragePeriod,
    amount: receipt.amount,
    receiptNumber: receipt.receiptNumber,
  };

  return {
    openingBalance: null,
    closingBalance: null,
    transactions: [],
    metadata,
  };
}
