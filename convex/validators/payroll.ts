/**
 * Payroll report validator.
 *
 * Three validation phases, each producing checklist items:
 *
 *  Phase 1 — Register internal integrity
 *    • Net pay formula: Gross Pay − Total Deductions = Net Pay
 *
 *  Phase 2 — Register ↔ Journal Extract cross-checks
 *    • Staff Salaries (journal debit) = Gross Pay (register)
 *    • NAPSA Employer Expense (journal debit) = NAPSA (register)
 *    • NHIMA Employer Expense (journal debit) = NHIMA (register)
 *    • NAPSA Payable (journal credit) = 2 × NAPSA (register)
 *    • NHIMA Payable (journal credit) = 2 × NHIMA (register)
 *    • ZRA Tax Payable (journal credit) = PAYE (register)
 *    • Staff Deductions Control (journal credit) = non-statutory deductions (register)
 *    • Net Pay Control (journal credit) = Net Pay (register)
 *    • Journal debits = journal credits (balanced)
 *
 *  Phase 3 — Journal ↔ QuickBooks verification (only when QB data file is present)
 *    • Staff Salaries expensed in QB
 *    • NAPSA Employer Contribution Expense posted in QB
 *    • NHIMA Employer Contribution Expense posted in QB
 *    • NAPSA Payable updated in QB
 *    • NHIMA Payable updated in QB
 *    • Net Pay Control posted in QB
 */

import type {
  ChecklistItem,
  ParsedFile,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from "./types";

// ─── Points ───────────────────────────────────────────────────────────────────

const CHECK_POINTS: Record<string, number> = {
  // Phase 1
  netPayFormula: 10,
  // Phase 2
  staffSalariesMatch: 10,
  napsaExpenseMatch: 5,
  nhimaExpenseMatch: 5,
  napsaPayableDouble: 8,
  nhimaPayableDouble: 8,
  zraPayableMatch: 8,
  deductionsControlMatch: 8,
  netPayControlMatch: 10,
  journalBalanced: 8,
  // Phase 3 (QB)
  qbStaffSalaries: 5,
  qbNapsaExpense: 3,
  qbNhimaExpense: 3,
  qbNapsaPayable: 3,
  qbNhimaPayable: 3,
  qbNetPayControl: 3,
  // 100 points total (without QB: 80 — QB adds 20)
};

export function payrollMaxPoints(rules: ValidationRule[]): number {
  return Object.keys(CHECK_POINTS).reduce((sum, key) => {
    const rule = rules.find((r) => r.key === key);
    return rule?.enabled !== false ? sum + CHECK_POINTS[key] : sum;
  }, 0);
}

function ruleEnabled(rules: ValidationRule[], key: string): boolean {
  const rule = rules.find((r) => r.key === key);
  return rule?.enabled !== false; // default to enabled if not found
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOLERANCE = 0.02; // ZMW — allow 2 ngwee rounding difference

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOLERANCE;
}

function fmt(n: number): string {
  return "ZMW " + n.toLocaleString("en-ZM", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function makeItem(
  key: string,
  title: string,
  pass: boolean,
  passMsg: string,
  failMsg: string,
  severity: ChecklistItem["severity"] = "high",
): ChecklistItem {
  return {
    title,
    status: pass ? "pass" : "fail",
    explanation: pass ? passMsg : failMsg,
    severity: pass ? "low" : severity,
    points: pass ? CHECK_POINTS[key] : 0,
    maxPoints: CHECK_POINTS[key],
  };
}

function skipped(key: string, title: string, reason: string): ChecklistItem {
  return {
    title,
    status: "warning",
    explanation: reason,
    severity: "medium",
    points: 0,
    maxPoints: CHECK_POINTS[key],
  };
}

// ─── Metadata accessors ───────────────────────────────────────────────────────

type Meta = Record<string, string | number | null>;

function n(meta: Meta, key: string): number {
  const v = meta[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const p = parseFloat(v);
    return Number.isFinite(p) ? p : 0;
  }
  return 0;
}

// ─── Validator ────────────────────────────────────────────────────────────────

export async function payrollValidator(
  files: ParsedFile[],
  rules: ValidationRule[],
  _context: ValidationContext,
): Promise<ValidationResult> {
  // ── Locate the three expected files ───────────────────────────────────────
  const registerFile = files.find((f) =>
    /payroll\s*register|register/i.test(f.label)
  );
  const extractFile = files.find((f) =>
    /extract|journal/i.test(f.label)
  );
  const qbFile = files.find((f) =>
    /quickbooks|qb\s*payroll|qb\s*journal/i.test(f.label)
  );

  const regMeta: Meta = registerFile?.statement.metadata ?? {};
  const extMeta: Meta = extractFile?.statement.metadata ?? {};
  const qbMeta:  Meta = qbFile?.statement.metadata ?? {};

  const hasRegister = !!registerFile;
  const hasExtract  = !!extractFile;
  const hasQb       = !!qbFile;

  const checklist: ChecklistItem[] = [];

  // ══ Phase 1 — Register integrity ══════════════════════════════════════════
  if (ruleEnabled(rules, "netPayFormula")) {
    if (!hasRegister) {
      checklist.push(skipped("netPayFormula", "Net pay formula check", "Payroll Register not uploaded."));
    } else {
      const gross = n(regMeta, "grossPay");
      const totalDed = n(regMeta, "totalDeductions");
      const netPay  = n(regMeta, "netPay");
      const computed = gross - totalDed;
      const pass = close(computed, netPay);
      checklist.push(makeItem(
        "netPayFormula",
        "Net pay formula: Gross − Total Deductions = Net Pay",
        pass,
        `${fmt(gross)} − ${fmt(totalDed)} = ${fmt(computed)}, matches Net Pay of ${fmt(netPay)}.`,
        `Formula gives ${fmt(computed)} but register shows Net Pay of ${fmt(netPay)} — difference of ${fmt(Math.abs(computed - netPay))}.`,
        "critical",
      ));
    }
  }

  // ══ Phase 2 — Register ↔ Extract ══════════════════════════════════════════
  if (!hasRegister || !hasExtract) {
    // Bulk-skip Phase 2 with a single warning item if either file is missing.
    const missing = [!hasRegister && "Payroll Register", !hasExtract && "Payroll Journal Extract"]
      .filter(Boolean).join(" and ");
    const phase2Keys = [
      "staffSalariesMatch","napsaExpenseMatch","nhimaExpenseMatch",
      "napsaPayableDouble","nhimaPayableDouble","zraPayableMatch",
      "deductionsControlMatch","netPayControlMatch","journalBalanced",
    ];
    for (const key of phase2Keys) {
      if (ruleEnabled(rules, key)) {
        checklist.push(skipped(key, key, `${missing} not uploaded — cross-check skipped.`));
      }
    }
  } else {
    const grossPay = n(regMeta, "grossPay");
    const napsa    = n(regMeta, "napsa");
    const nhima    = n(regMeta, "nhima");
    const paye     = n(regMeta, "paye");
    const nonStat  = n(regMeta, "nonStatutoryDeductions");
    const netPay   = n(regMeta, "netPay");

    if (ruleEnabled(rules, "staffSalariesMatch")) {
      const journalVal = n(extMeta, "staffSalaries");
      const pass = close(journalVal, grossPay);
      checklist.push(makeItem(
        "staffSalariesMatch",
        "Staff Salaries (journal) = Gross Pay (register)",
        pass,
        `Both show ${fmt(grossPay)}.`,
        `Journal shows ${fmt(journalVal)} but register Gross Pay is ${fmt(grossPay)} — difference of ${fmt(Math.abs(journalVal - grossPay))}.`,
        "critical",
      ));
    }

    if (ruleEnabled(rules, "napsaExpenseMatch")) {
      const journalVal = n(extMeta, "napsaEmployerExpense");
      const pass = close(journalVal, napsa);
      checklist.push(makeItem(
        "napsaExpenseMatch",
        "NAPSA Employer Expense (journal) = NAPSA (register)",
        pass,
        `Both show ${fmt(napsa)}.`,
        `Journal NAPSA Employer Expense is ${fmt(journalVal)} but register NAPSA is ${fmt(napsa)}.`,
        "high",
      ));
    }

    if (ruleEnabled(rules, "nhimaExpenseMatch")) {
      const journalVal = n(extMeta, "nhimaEmployerExpense");
      const pass = close(journalVal, nhima);
      checklist.push(makeItem(
        "nhimaExpenseMatch",
        "NHIMA Employer Expense (journal) = NHIMA (register)",
        pass,
        `Both show ${fmt(nhima)}.`,
        `Journal NHIMA Employer Expense is ${fmt(journalVal)} but register NHIMA is ${fmt(nhima)}.`,
        "high",
      ));
    }

    if (ruleEnabled(rules, "napsaPayableDouble")) {
      const expected   = napsa * 2;
      const journalVal = n(extMeta, "napsaPayable");
      const pass = close(journalVal, expected);
      checklist.push(makeItem(
        "napsaPayableDouble",
        "NAPSA Payable (journal) = 2 × NAPSA (register)",
        pass,
        `${fmt(napsa)} × 2 = ${fmt(expected)}, journal shows ${fmt(journalVal)}.`,
        `NAPSA Payable should be ${fmt(expected)} (2 × ${fmt(napsa)}) but journal shows ${fmt(journalVal)}.`,
        "high",
      ));
    }

    if (ruleEnabled(rules, "nhimaPayableDouble")) {
      const expected   = nhima * 2;
      const journalVal = n(extMeta, "nhimaPayable");
      const pass = close(journalVal, expected);
      checklist.push(makeItem(
        "nhimaPayableDouble",
        "NHIMA Payable (journal) = 2 × NHIMA (register)",
        pass,
        `${fmt(nhima)} × 2 = ${fmt(expected)}, journal shows ${fmt(journalVal)}.`,
        `NHIMA Payable should be ${fmt(expected)} (2 × ${fmt(nhima)}) but journal shows ${fmt(journalVal)}.`,
        "high",
      ));
    }

    if (ruleEnabled(rules, "zraPayableMatch")) {
      const journalVal = n(extMeta, "zraTaxPayable");
      const pass = close(journalVal, paye);
      checklist.push(makeItem(
        "zraPayableMatch",
        "ZRA Tax Payable (journal) = PAYE (register)",
        pass,
        `Both show ${fmt(paye)}.`,
        `Journal ZRA Tax Payable is ${fmt(journalVal)} but register PAYE is ${fmt(paye)}.`,
        "high",
      ));
    }

    if (ruleEnabled(rules, "deductionsControlMatch")) {
      const journalVal = n(extMeta, "staffDeductionsControl");
      const pass = close(journalVal, nonStat);
      checklist.push(makeItem(
        "deductionsControlMatch",
        "Staff Deductions Control (journal) = non-statutory deductions (register)",
        pass,
        `Both show ${fmt(nonStat)} (school fees + salary advance + staff loans + other deductions).`,
        `Journal Staff Deductions Control is ${fmt(journalVal)} but register non-statutory deductions total ${fmt(nonStat)}.`,
        "high",
      ));
    }

    if (ruleEnabled(rules, "netPayControlMatch")) {
      const journalVal = n(extMeta, "netPayControl");
      const pass = close(journalVal, netPay);
      checklist.push(makeItem(
        "netPayControlMatch",
        "Net Pay Control (journal) = Net Pay (register)",
        pass,
        `Both show ${fmt(netPay)}.`,
        `Journal Net Pay Control is ${fmt(journalVal)} but register Net Pay is ${fmt(netPay)}.`,
        "critical",
      ));
    }

    if (ruleEnabled(rules, "journalBalanced")) {
      const totalDebits  = n(extMeta, "totalDebits");
      const totalCredits = n(extMeta, "totalCredits");
      const pass = close(totalDebits, totalCredits);
      checklist.push(makeItem(
        "journalBalanced",
        "Payroll journal is balanced (debits = credits)",
        pass,
        `Debits ${fmt(totalDebits)} = Credits ${fmt(totalCredits)}.`,
        `Debits ${fmt(totalDebits)} ≠ Credits ${fmt(totalCredits)} — journal is out of balance by ${fmt(Math.abs(totalDebits - totalCredits))}.`,
        "critical",
      ));
    }
  }

  // ══ Phase 3 — QuickBooks verification ════════════════════════════════════
  const qbChecks: Array<{ key: string; title: string; qbKey: string; expectedFn: () => number }> = [
    {
      key: "qbStaffSalaries",
      title: "Gross Pay expensed in QB as Staff Salaries",
      qbKey: "qb_staffSalaries",
      expectedFn: () => n(extMeta, "staffSalaries"),
    },
    {
      key: "qbNapsaExpense",
      title: "NAPSA Employer Expense posted in QB",
      qbKey: "qb_napsaEmployerExpense",
      expectedFn: () => n(extMeta, "napsaEmployerExpense"),
    },
    {
      key: "qbNhimaExpense",
      title: "NHIMA Employer Expense posted in QB",
      qbKey: "qb_nhimaEmployerExpense",
      expectedFn: () => n(extMeta, "nhimaEmployerExpense"),
    },
    {
      key: "qbNapsaPayable",
      title: "NAPSA Payable updated in QB",
      qbKey: "qb_napsaPayable",
      expectedFn: () => n(extMeta, "napsaPayable"),
    },
    {
      key: "qbNhimaPayable",
      title: "NHIMA Payable updated in QB",
      qbKey: "qb_nhimaPayable",
      expectedFn: () => n(extMeta, "nhimaPayable"),
    },
    {
      key: "qbNetPayControl",
      title: "Net Pay posted in QB under Wages & Salaries Control",
      qbKey: "qb_netPayControl",
      expectedFn: () => n(extMeta, "netPayControl"),
    },
  ];

  for (const { key, title, qbKey, expectedFn } of qbChecks) {
    if (!ruleEnabled(rules, key)) continue;
    if (!hasQb) {
      checklist.push(skipped(key, title, "QuickBooks payroll data not yet synced — click 'Sync from QB' to verify."));
      continue;
    }
    const qbAmount = n(qbMeta, qbKey);
    const expected = expectedFn();
    if (expected === 0) {
      checklist.push(skipped(key, title, "Expected amount is zero — skipped."));
      continue;
    }
    const pass = close(qbAmount, expected);
    checklist.push(makeItem(
      key,
      title,
      pass,
      `QB shows ${fmt(qbAmount)}, matching journal of ${fmt(expected)}.`,
      qbAmount === 0
        ? `No matching entry found in QuickBooks for the period (expected ${fmt(expected)}).`
        : `QB shows ${fmt(qbAmount)} but journal expects ${fmt(expected)} — difference of ${fmt(Math.abs(qbAmount - expected))}.`,
      "high",
    ));
  }

  // ── Score & summary ───────────────────────────────────────────────────────
  const score    = checklist.reduce((s, c) => s + c.points, 0);
  const maxScore = checklist.reduce((s, c) => s + c.maxPoints, 0);
  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  const failures  = checklist.filter((c) => c.status === "fail");
  const warnings  = checklist.filter((c) => c.status === "warning");
  const criticals = failures.filter((c) => c.severity === "critical");

  let summary: string;
  if (failures.length === 0 && warnings.filter((w) => !w.explanation.includes("QuickBooks")).length === 0) {
    summary = `Payroll is fully validated. Score: ${score}/${maxScore} (${pct}%).`;
  } else if (criticals.length > 0) {
    summary = `${criticals.length} critical payroll discrepanc${criticals.length === 1 ? "y" : "ies"} found. Score: ${score}/${maxScore} (${pct}%).`;
  } else {
    summary = `${failures.length} issue(s), ${warnings.length} warning(s). Score: ${score}/${maxScore} (${pct}%).`;
  }

  const recommendations: string[] = [];
  if (failures.some((c) => c.title.includes("formula"))) {
    recommendations.push("Verify that all deduction columns in the payroll register are correctly totalled.");
  }
  if (failures.some((c) => c.title.includes("Payable") && c.title.includes("NAPSA"))) {
    recommendations.push("NAPSA Payable in the journal should equal the sum of employer + employee contributions (2×).");
  }
  if (failures.some((c) => c.title.includes("Payable") && c.title.includes("NHIMA"))) {
    recommendations.push("NHIMA Payable in the journal should equal the sum of employer + employee contributions (2×).");
  }
  if (warnings.some((w) => w.explanation.includes("QuickBooks"))) {
    recommendations.push("Sync QuickBooks payroll data to complete Phase 3 verification.");
  }

  return { score, checklist, summary, recommendations };
}
