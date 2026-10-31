import { extractMew3Document, type Extraction } from "../lib/mew3/extract";
import { addDays, kwacha } from "../lib/mew3/recon";
import type { Mew3DocKind } from "../lib/mew3/types";
import type { ChecklistItem, ParsedFile, ValidationContext, ValidationResult, ValidationRule } from "./types";

/**
 * Validators for MEW3 Apartments' three daily Finance documents. Each one
 * reads the scanned paperwork into rows (lib/mew3/extract.ts), scores whether
 * it arrived, could be read and is for the right day, and hands the rows back
 * as `records` so the daily reconciliation automation can cross-check them.
 */

export const MEW3_DOC_VALIDATORS: Record<string, Mew3DocKind> = {
  mew3GuestRegister: "guestRegister",
  mew3Receipts: "receipts",
  mew3Deposits: "deposits",
};

const POINTS = { attached: 30, read: 40, rightDay: 30 };

export function mew3DocumentMaxPoints(): number {
  return POINTS.attached + POINTS.read + POINTS.rightDay;
}

const NOUN: Record<Mew3DocKind, [string, string]> = {
  guestRegister: ["guest", "guests"],
  receipts: ["receipt", "receipts"],
  deposits: ["deposit", "deposits"],
};

function rowDates(e: Extraction): Array<string | null> {
  if (e.kind === "guestRegister") return e.rows.map((r) => r.checkIn);
  return e.rows.map((r) => r.date);
}

function summarize(e: Extraction): Record<string, string | number | null> {
  // Row count is shown as the file's transaction count; "unreadable" only when something could not be read.
  const base = { documentDate: e.documentDate, ...(e.unreadable ? { unreadable: e.unreadable } : {}) };
  if (e.kind === "guestRegister") {
    return { ...base, checkIns: e.rows.length, people: e.rows.reduce((s, r) => s + (r.guests ?? 1), 0) };
  }
  const total = Math.round(e.rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  if (e.kind === "receipts") {
    const by = (m: string[]) => Math.round(e.rows.filter((r) => m.includes(r.paymentMethod)).reduce((s, r) => s + r.amount, 0) * 100) / 100;
    return { ...base, totalReceived: total, cash: by(["cash"]), mobileMoney: by(["airtel", "mtn"]), moneywise: by(["moneywise"]), otherMethods: by(["bank", "card", "other", "unknown"]) };
  }
  return { ...base, totalDeposited: total };
}

function makeValidator(kind: Mew3DocKind) {
  return async function mew3DocumentValidator(
    files: ParsedFile[],
    _rules: ValidationRule[],
    context: ValidationContext,
  ): Promise<ValidationResult> {
    const checklist: ChecklistItem[] = [];
    const recommendations: string[] = [];
    const [one, many] = NOUN[kind];
    const date = context.periodLabel ?? "";
    const readTitle = `${many[0].toUpperCase()}${many.slice(1)} read`;
    const raws = files.map((f) => f.raw).filter((r): r is NonNullable<typeof r> => !!r);

    checklist.push(
      raws.length
        ? { title: "Document attached", status: "pass", explanation: `${raws.length} file${raws.length === 1 ? "" : "s"} uploaded.`, severity: "low", points: POINTS.attached, maxPoints: POINTS.attached }
        : { title: "Document attached", status: "fail", explanation: "Nothing was uploaded.", severity: "critical", points: 0, maxPoints: POINTS.attached },
    );

    let extraction: Extraction | null = null;
    if (!raws.length) {
      checklist.push({ title: readTitle, status: "fail", explanation: "There was nothing to read.", severity: "critical", points: 0, maxPoints: POINTS.read });
    } else if (!context.ai) {
      // Without an AI integration nothing can be read; that is the organization's gap, not the submitter's.
      checklist.push({ title: readTitle, status: "warning", explanation: "Not read: no AI integration is connected, so the daily reconciliation cannot use this document.", severity: "medium", points: POINTS.read, maxPoints: POINTS.read });
      recommendations.push("Connect an AI integration so documents can be read for the daily reconciliation.");
    } else {
      try {
        extraction = await extractMew3Document(kind, raws, context.ai, date, context.aiFields ?? []);
        const n = extraction.rows.length;
        const s = summarize(extraction);
        const total = kind === "guestRegister" ? "" : ` totalling ${kwacha(Number(s.totalReceived ?? s.totalDeposited ?? 0))}`;
        const note = extraction.unreadable ? ` Could not read: ${extraction.unreadable}.` : "";
        checklist.push(
          n > 0
            ? { title: readTitle, status: extraction.unreadable ? "warning" : "pass", explanation: `Read ${n} ${n === 1 ? one : many}${total}.${note}`, severity: extraction.unreadable ? "medium" : "low", points: POINTS.read, maxPoints: POINTS.read }
            : { title: readTitle, status: "fail", explanation: `No ${many} could be read from the upload.${note}`, severity: "high", points: 0, maxPoints: POINTS.read },
        );
        if (n === 0) recommendations.push("Re-upload a clearer scan — every page, flat and in focus.");
      } catch (err) {
        checklist.push({ title: readTitle, status: "warning", explanation: `Not read — the AI reader failed: ${err instanceof Error ? err.message : String(err)}. Re-run validation to try again.`, severity: "medium", points: POINTS.read, maxPoints: POINTS.read });
      }
    }

    // Deposits for a day's takings are often banked the next morning.
    const allowed = kind === "deposits" ? [date, addDays(date, 1)] : [date];
    if (extraction && extraction.rows.length) {
      const dated = rowDates(extraction).filter((d): d is string => !!d);
      const off = dated.filter((d) => !allowed.includes(d));
      const docOff = extraction.documentDate && !allowed.includes(extraction.documentDate);
      const what = kind === "guestRegister" ? "check-in dates" : kind === "receipts" ? "receipt dates" : "deposit dates";
      if (dated.length === 0 && !extraction.documentDate) {
        checklist.push({ title: `Document is for ${date}`, status: "warning", explanation: "No dates could be read, so the day could not be confirmed.", severity: "low", points: POINTS.rightDay, maxPoints: POINTS.rightDay });
      } else if (off.length > dated.length / 2 || (dated.length === 0 && docOff)) {
        checklist.push({ title: `Document is for ${date}`, status: "fail", explanation: `Most ${what} are not ${date} (e.g. ${off.slice(0, 3).join(", ") || extraction.documentDate}) — was the wrong day's document uploaded?`, severity: "high", points: 0, maxPoints: POINTS.rightDay });
        recommendations.push(`Upload the ${date} document, or submit this one under its own date.`);
      } else if (off.length) {
        checklist.push({ title: `Document is for ${date}`, status: "warning", explanation: `${off.length} of ${dated.length} ${what} are a different day: ${[...new Set(off)].slice(0, 3).join(", ")}.`, severity: "low", points: POINTS.rightDay, maxPoints: POINTS.rightDay });
      } else {
        checklist.push({ title: `Document is for ${date}`, status: "pass", explanation: `All ${what} are ${allowed.join(" or ")}.`, severity: "low", points: POINTS.rightDay, maxPoints: POINTS.rightDay });
      }
    } else {
      checklist.push({ title: `Document is for ${date}`, status: raws.length ? "warning" : "fail", explanation: raws.length ? "Not checked — the document was not read." : "Nothing was uploaded.", severity: "low", points: raws.length ? POINTS.rightDay : 0, maxPoints: POINTS.rightDay });
    }

    const score = checklist.reduce((s, c) => s + c.points, 0);
    const failures = checklist.filter((c) => c.status === "fail").length;
    return {
      score,
      checklist,
      summary: failures
        ? `${failures} of ${checklist.length} checks failed.`
        : extraction
          ? `${extraction.rows.length} ${extraction.rows.length === 1 ? one : many} read for ${date}.`
          : `${context.templateName ?? "Document"} received.`,
      recommendations,
      ...(extraction ? { records: { kind, rows: extraction.rows, summary: summarize(extraction) } } : {}),
    };
  };
}

export const mew3GuestRegisterValidator = makeValidator("guestRegister");
export const mew3ReceiptsValidator = makeValidator("receipts");
export const mew3DepositsValidator = makeValidator("deposits");
