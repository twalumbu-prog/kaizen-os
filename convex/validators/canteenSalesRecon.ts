import type {
  ChecklistItem,
  ParsedFile,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from "./types";

// ─── Points per check ─────────────────────────────────────────────────────────

const CHECK_POINTS: Record<string, number> = {
  /** Recon date == Inventory date (both documents cover the same day). */
  datesMatch: 15,
  /** Document dates match the report period (same-day generation required). */
  timeliness: 20,
  /** "How Many Children Ate" in Inventory == student row count in Recon. */
  childrenCountMatch: 20,
  /** Footer Cash total == sum of individual Cash column values. */
  cashTotalCorrect: 10,
  /** Footer Airtel total == sum of individual Airtel column values. */
  airtelTotalCorrect: 10,
  /** Grand Total == Cash Total + Airtel Total (+ MasterFees). */
  grandTotalCorrect: 10,
  /** Proof-of-payment amount == AMT Deposited field in Recon. */
  depositMatchesRecon: 15,
};

export function canteenSalesReconMaxPoints(rules: ValidationRule[]): number {
  return Object.keys(CHECK_POINTS).reduce((sum, key) => {
    const rule = rules.find((r) => r.key === key);
    return (rule?.enabled ?? true) ? sum + CHECK_POINTS[key] : sum;
  }, 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ruleEnabled(rules: ValidationRule[], key: string): boolean {
  return rules.find((r) => r.key === key)?.enabled ?? true;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Returns true if |a - b| ≤ tolerance (default 0.01). */
function near(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) <= tolerance;
}

/** Format an ISO date string as "26 Aug 2026" for human-readable messages. */
function fmtDate(iso: string | null): string {
  if (!iso) return "n/a";
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-ZM", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** ISO date string for a Unix ms timestamp, UTC midnight. */
function msToIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Retrieve a metadata value, typed as T. */
function meta<T>(file: ParsedFile, key: string): T | null {
  return (file.statement.metadata?.[key] as T | undefined) ?? null;
}

// ─── Validator ────────────────────────────────────────────────────────────────

/**
 * Canteen Sales Recon validator.
 *
 * Expects three files (matched by label substring, case-insensitive):
 *   "Sales Collection Recon" or "Sales Recon"  → canteen recon xlsx
 *   "Inventory"                                 → ingredients inventory xlsx
 *   "Proof"                                     → proof-of-payment PDF
 */
export async function canteenSalesReconValidator(
  files: ParsedFile[],
  rules: ValidationRule[],
  context: ValidationContext,
): Promise<ValidationResult> {
  const find = (hint: RegExp) => files.find((f) => hint.test(f.label));

  const reconFile    = find(/recon|sales collection/i);
  const inventoryFile = find(/inventor/i);
  const receiptFile  = find(/proof|receipt|deposit/i);

  const checklist: ChecklistItem[] = [];
  const recommendations: string[] = [];
  let earned = 0;
  let possible = 0;

  // ── Helper: push a checklist item ─────────────────────────────────────────
  const push = (
    key: string,
    title: string,
    ok: boolean,
    passMsg: string,
    failMsg: string,
    severity: ChecklistItem["severity"] = "high",
  ) => {
    if (!ruleEnabled(rules, key)) return;
    const pts = CHECK_POINTS[key];
    possible += pts;
    if (ok) earned += pts;
    checklist.push({
      title,
      status: ok ? "pass" : "fail",
      explanation: ok ? passMsg : failMsg,
      severity: ok ? "low" : severity,
      points: ok ? pts : 0,
      maxPoints: pts,
    });
  };

  // ── 1. Dates match between the two Excel files ────────────────────────────
  if (ruleEnabled(rules, "datesMatch")) {
    const reconDate     = reconFile     ? meta<string>(reconFile,     "date") : null;
    const inventoryDate = inventoryFile ? meta<string>(inventoryFile, "date") : null;

    if (!reconFile || !inventoryFile) {
      push("datesMatch", "Document Dates Match",
        false,
        "",
        `Missing file(s): ${!reconFile ? "Canteen Sales Recon " : ""}${!inventoryFile ? "Ingredients Inventory" : ""}.`.trim(),
        "critical");
    } else if (!reconDate || !inventoryDate) {
      push("datesMatch", "Document Dates Match",
        false,
        "",
        `Could not read the date from ${!reconDate ? "the Sales Recon" : "the Inventory Tracker"}. Make sure the Date field is filled in.`,
        "high");
    } else {
      const ok = reconDate === inventoryDate;
      push("datesMatch", "Document Dates Match",
        ok,
        `Both documents are dated ${fmtDate(reconDate)}.`,
        `Sales Recon is dated ${fmtDate(reconDate)} but the Inventory Tracker is dated ${fmtDate(inventoryDate)} — they must cover the same day.`,
        "high");
      if (!ok) recommendations.push("Re-submit with matching dates on both Excel files.");
    }
  }

  // ── 2. Timeliness — document dates match the reporting period ─────────────
  if (ruleEnabled(rules, "timeliness")) {
    const periodIso = msToIso(context.periodStart);
    const reconDate     = reconFile     ? meta<string>(reconFile,     "date") : null;
    const inventoryDate = inventoryFile ? meta<string>(inventoryFile, "date") : null;
    const receiptDate   = receiptFile   ? meta<string>(receiptFile,   "date") : null;

    const mismatches: string[] = [];
    if (reconFile     && reconDate     && reconDate     !== periodIso) mismatches.push(`Sales Recon (${fmtDate(reconDate)})`);
    if (inventoryFile && inventoryDate && inventoryDate !== periodIso) mismatches.push(`Inventory Tracker (${fmtDate(inventoryDate)})`);
    if (receiptFile   && receiptDate   && receiptDate   !== periodIso) mismatches.push(`Proof of Payment (${fmtDate(receiptDate)})`);

    const ok = mismatches.length === 0;
    push("timeliness", "Same-Day Submission",
      ok,
      `All documents are dated ${fmtDate(periodIso)}, matching the reporting day.`,
      `The following document(s) are not dated ${fmtDate(periodIso)} (the reporting day): ${mismatches.join("; ")}. Documents must be generated and submitted on the day they cover.`,
      "high");
    if (!ok) recommendations.push("Ensure all documents are prepared and deposited on the same day the canteen operates.");
  }

  // ── 3. Children count matches student rows ────────────────────────────────
  if (ruleEnabled(rules, "childrenCountMatch")) {
    const childrenAte  = inventoryFile ? meta<number>(inventoryFile, "childrenAte")  : null;
    const studentCount = reconFile     ? meta<number>(reconFile,     "studentCount") : null;

    if (childrenAte === null || studentCount === null) {
      push("childrenCountMatch", "Children Count Matches Student Rows",
        false,
        "",
        `Could not read ${childrenAte === null ? '"How Many Children Ate" from the Inventory Tracker' : '"student count" from the Sales Recon'}.`,
        "high");
    } else {
      const ok = childrenAte === studentCount;
      push("childrenCountMatch", "Children Count Matches Student Rows",
        ok,
        `"How Many Children Ate" (${childrenAte}) matches the ${studentCount} student row${studentCount === 1 ? "" : "s"} on the Recon.`,
        `"How Many Children Ate on This Day?" says ${childrenAte}, but the Sales Recon lists ${studentCount} student${studentCount === 1 ? "" : "s"} — a difference of ${Math.abs(childrenAte - studentCount)}.`,
        "high");
      if (!ok) recommendations.push("Reconcile the children-ate figure with the actual student count on the Sales Recon.");
    }
  }

  // ── 4. Cash column total ──────────────────────────────────────────────────
  if (ruleEnabled(rules, "cashTotalCorrect") && reconFile) {
    const cashTotal = meta<number>(reconFile, "cashTotal");
    const cashSum   = meta<number>(reconFile, "cashSum");
    if (cashTotal === null || cashSum === null) {
      push("cashTotalCorrect", "Cash Total Is Correct",
        false, "",
        "Could not read the Cash total or individual Cash amounts from the Sales Recon.",
        "medium");
    } else {
      const ok = near(cashTotal, cashSum);
      const diff = round2(cashTotal - cashSum);
      push("cashTotalCorrect", "Cash Total Is Correct",
        ok,
        `Cash total (${cashTotal.toFixed(2)}) matches the sum of individual cash entries.`,
        `Cash footer total (${cashTotal.toFixed(2)}) does not match the sum of individual cash entries (${cashSum.toFixed(2)}) — a difference of ${diff > 0 ? "+" : ""}${diff.toFixed(2)}.`,
        "high");
    }
  }

  // ── 5. Airtel column total ────────────────────────────────────────────────
  if (ruleEnabled(rules, "airtelTotalCorrect") && reconFile) {
    const airtelTotal = meta<number>(reconFile, "airtelTotal");
    const airtelSum   = meta<number>(reconFile, "airtelSum");
    if (airtelTotal === null || airtelSum === null) {
      push("airtelTotalCorrect", "Airtel Total Is Correct",
        false, "",
        "Could not read the Airtel total or individual Airtel amounts from the Sales Recon.",
        "medium");
    } else {
      const ok = near(airtelTotal, airtelSum);
      const diff = round2(airtelTotal - airtelSum);
      push("airtelTotalCorrect", "Airtel Total Is Correct",
        ok,
        `Airtel total (${airtelTotal.toFixed(2)}) matches the sum of individual Airtel entries.`,
        `Airtel footer total (${airtelTotal.toFixed(2)}) does not match the sum of individual Airtel entries (${airtelSum.toFixed(2)}) — a difference of ${diff > 0 ? "+" : ""}${diff.toFixed(2)}.`,
        "high");
    }
  }

  // ── 6. Grand Total — every payment method's footer figure sums to the same
  //      total as summing every individual entry across the whole sheet.
  //      The real template has no separately-typed "Grand Total" cell to check
  //      against, so this instead verifies the footer row itself is internally
  //      consistent with the rows it is supposed to total. ────────────────────
  if (ruleEnabled(rules, "grandTotalCorrect") && reconFile) {
    const methods = ["cash", "airtel", "wise", "bank", "master"] as const;
    const footerRead = methods.some((m) => meta<number>(reconFile, `${m}Total`) !== null);

    if (!footerRead) {
      push("grandTotalCorrect", "Grand Total Is Correct",
        false, "",
        "Could not find the Total row on the Sales Recon.",
        "medium");
    } else {
      const footerTotal = round2(
        methods.reduce((sum, m) => sum + (meta<number>(reconFile, `${m}Total`) ?? 0), 0),
      );
      const rowSum = round2(
        methods.reduce((sum, m) => sum + (meta<number>(reconFile, `${m}Sum`) ?? 0), 0),
      );
      const ok = near(footerTotal, rowSum);
      const diff = round2(footerTotal - rowSum);
      push("grandTotalCorrect", "Grand Total Is Correct",
        ok,
        `The Total row (${footerTotal.toFixed(2)}) matches the sum of every individual entry (${rowSum.toFixed(2)}) across all payment methods.`,
        `The Total row (${footerTotal.toFixed(2)}) does not match the sum of every individual entry across all payment methods (${rowSum.toFixed(2)}) — a difference of ${diff > 0 ? "+" : ""}${diff.toFixed(2)}.`,
        "high");
      if (!ok) recommendations.push("Recheck the Total row — it should equal the sum of every payment column added up individually.");
    }
  }

  // ── 7. Proof-of-payment amount matches AMT Deposited ─────────────────────
  if (ruleEnabled(rules, "depositMatchesRecon")) {
    const amtDeposited = reconFile   ? meta<number>(reconFile,   "amtDeposited") : null;
    const amtPaid      = receiptFile ? meta<number>(receiptFile, "amountPaid")   : null;

    if (!reconFile || !receiptFile) {
      push("depositMatchesRecon", "Deposit Amount Matches Proof of Payment",
        false, "",
        `Missing file(s): ${!reconFile ? "Canteen Sales Recon " : ""}${!receiptFile ? "Proof of Payment" : ""}.`.trim(),
        "critical");
    } else if (amtDeposited === null) {
      push("depositMatchesRecon", "Deposit Amount Matches Proof of Payment",
        false, "",
        "The AMT Deposited field in the Sales Recon is blank. Fill it in with the amount actually deposited.",
        "high");
    } else if (amtPaid === null) {
      push("depositMatchesRecon", "Deposit Amount Matches Proof of Payment",
        false, "",
        "Could not extract the amount paid from the Proof of Payment PDF. Check that the correct receipt was uploaded.",
        "high");
    } else {
      const ok = near(amtDeposited, amtPaid);
      const diff = round2(amtDeposited - amtPaid);
      push("depositMatchesRecon", "Deposit Amount Matches Proof of Payment",
        ok,
        `AMT Deposited (ZMW ${amtDeposited.toFixed(2)}) matches the receipt amount (ZMW ${amtPaid.toFixed(2)}).`,
        `AMT Deposited on the Recon (ZMW ${amtDeposited.toFixed(2)}) does not match the Proof of Payment (ZMW ${amtPaid.toFixed(2)}) — a difference of ${diff > 0 ? "+" : ""}${diff.toFixed(2)}.`,
        "critical");
      if (!ok) recommendations.push("The amount on the proof of deposit must match the AMT Deposited figure on the Sales Recon.");
    }
  }

  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;

  const passing = checklist.filter((c) => c.status === "pass").length;
  const total   = checklist.length;
  const summary =
    score === 100
      ? "All canteen recon checks passed — fully reconciled."
      : `${passing} of ${total} checks passed (${score}%). ${recommendations[0] ?? ""}`.trim();

  return { score, checklist, summary, recommendations };
}
