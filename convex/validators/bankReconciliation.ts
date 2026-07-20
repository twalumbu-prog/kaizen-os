import { sliceStatementToPeriod } from "../lib/periodSlice";
import type {
  ChecklistItem,
  ParsedFile,
  Transaction,
  ValidationContext,
  ValidationResult,
  ValidationRule,
} from "./types";

const CHARGE_KEYWORDS = /fee|charge|service\s*charge|commission/i;
const INTEREST_KEYWORDS = /interest/i;
const OUTSTANDING_WINDOW_DAYS = 7;

const CHECK_POINTS: Record<string, number> = {
  openingBalance: 15,
  closingBalance: 15,
  openingBalanceContinuity: 15,
  debitsReconcile: 10,
  creditsReconcile: 10,
  duplicates: 10,
  missingEntries: 15,
  outstandingCheques: 5,
  depositsInTransit: 5,
  bankCharges: 5,
  interest: 5,
  unknownTransactions: 5,
};

function ruleEnabled(rules: ValidationRule[], key: string): ValidationRule | undefined {
  const rule = rules.find((r) => r.key === key);
  return rule?.enabled ? rule : undefined;
}

function withinTolerance(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
}

function sumByType(transactions: Transaction[], type: Transaction["type"]): number {
  return transactions
    .filter((t) => t.type === type)
    .reduce((sum, t) => sum + t.amount, 0);
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  if (Number.isNaN(da) || Number.isNaN(db)) return Infinity;
  return Math.abs(da - db) / (1000 * 60 * 60 * 24);
}

/** Greedy amount+date matching; consumes matched items from `pool`. */
function matchAgainst(
  source: Transaction[],
  pool: Transaction[],
  tolerance: number,
): { matched: Transaction[]; unmatched: Transaction[] } {
  const remaining = [...pool];
  const matched: Transaction[] = [];
  const unmatched: Transaction[] = [];

  for (const tx of source) {
    const idx = remaining.findIndex(
      (candidate) =>
        withinTolerance(candidate.amount, tx.amount, tolerance) &&
        daysBetween(candidate.date, tx.date) <= 5,
    );
    if (idx === -1) {
      unmatched.push(tx);
    } else {
      matched.push(tx);
      remaining.splice(idx, 1);
    }
  }
  return { matched, unmatched };
}

function findDuplicates(transactions: Transaction[]): Transaction[] {
  const seen = new Map<string, number>();
  const duplicates: Transaction[] = [];
  for (const tx of transactions) {
    const key = `${tx.date}|${tx.description}|${tx.amount}|${tx.type}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) duplicates.push(tx);
  }
  return duplicates;
}

function latestDate(transactions: Transaction[]): string {
  return transactions.reduce(
    (latest, t) => (t.date > latest ? t.date : latest),
    "0000-00-00",
  );
}

/**
 * Pure reconciliation logic, decoupled from file parsing so it can be
 * unit-tested directly against structured fixtures.
 */
export function runBankReconciliationChecks(
  ledger: { openingBalance: number | null; closingBalance: number | null; transactions: Transaction[] },
  bank: { openingBalance: number | null; closingBalance: number | null; transactions: Transaction[] },
  rules: ValidationRule[],
  expectedOpeningBalance: number | null = null,
): ValidationResult {
  const checklist: ChecklistItem[] = [];
  const recommendations: string[] = [];
  const defaultTolerance = ruleEnabled(rules, "openingBalance")?.tolerance ?? 0.01;

  // 1. Opening balance
  const openingRule = ruleEnabled(rules, "openingBalance");
  if (openingRule) {
    const tolerance = openingRule.tolerance ?? defaultTolerance;
    const ok =
      ledger.openingBalance !== null &&
      bank.openingBalance !== null &&
      withinTolerance(ledger.openingBalance, bank.openingBalance, tolerance);
    const openingDiff =
      ledger.openingBalance !== null && bank.openingBalance !== null
        ? ledger.openingBalance - bank.openingBalance
        : null;
    checklist.push({
      title: "Opening balances match",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? `Ledger opening balance ${ledger.openingBalance} matches bank ${bank.openingBalance}.`
        : `Ledger opening balance (${ledger.openingBalance ?? "n/a"}) does not match bank statement (${bank.openingBalance ?? "n/a"})${
            openingDiff !== null
              ? ` — a difference of ${openingDiff > 0 ? "+" : ""}${openingDiff.toFixed(2)} (ledger ${openingDiff > 0 ? "higher" : "lower"}).`
              : "."
          }`,
      severity: ok ? "low" : "high",
      points: ok ? CHECK_POINTS.openingBalance : 0,
      maxPoints: CHECK_POINTS.openingBalance,
    });
    if (!ok) recommendations.push("Reconcile the opening balance discrepancy before proceeding.");
  }

  // 2. Closing balance
  const closingRule = ruleEnabled(rules, "closingBalance");
  if (closingRule) {
    const tolerance = closingRule.tolerance ?? defaultTolerance;
    const ok =
      ledger.closingBalance !== null &&
      bank.closingBalance !== null &&
      withinTolerance(ledger.closingBalance, bank.closingBalance, tolerance);
    const closingDiff =
      ledger.closingBalance !== null && bank.closingBalance !== null
        ? ledger.closingBalance - bank.closingBalance
        : null;
    checklist.push({
      title: "Closing balances match",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? `Ledger closing balance ${ledger.closingBalance} matches bank ${bank.closingBalance}.`
        : `Ledger closing balance (${ledger.closingBalance ?? "n/a"}) does not match bank statement (${bank.closingBalance ?? "n/a"})${
            closingDiff !== null
              ? ` — a difference of ${closingDiff > 0 ? "+" : ""}${closingDiff.toFixed(2)} (ledger ${closingDiff > 0 ? "higher" : "lower"}).`
              : "."
          }`,
      severity: ok ? "low" : "high",
      points: ok ? CHECK_POINTS.closingBalance : 0,
      maxPoints: CHECK_POINTS.closingBalance,
    });
    if (!ok) recommendations.push("Investigate the closing balance discrepancy.");
  }

  // 2b. Opening balance continuity: this period's bank opening should roll forward from last period's
  // validated closing balance (or the admin-seeded starting balance for the very first period).
  const continuityRule = ruleEnabled(rules, "openingBalanceContinuity");
  if (continuityRule) {
    if (expectedOpeningBalance === null) {
      checklist.push({
        title: "Opening Balance Continuity",
        status: "pass",
        explanation: "No prior period to compare against — treated as the first reconciled period.",
        severity: "low",
        points: CHECK_POINTS.openingBalanceContinuity,
        maxPoints: CHECK_POINTS.openingBalanceContinuity,
      });
    } else {
      const tolerance = continuityRule.tolerance ?? defaultTolerance;
      const ok =
        bank.openingBalance !== null &&
        withinTolerance(bank.openingBalance, expectedOpeningBalance, tolerance);
      const continuityDiff = bank.openingBalance !== null ? bank.openingBalance - expectedOpeningBalance : null;
      checklist.push({
        title: "Opening Balance Continuity",
        status: ok ? "pass" : "fail",
        explanation: ok
          ? `This period's opening balance (${bank.openingBalance}) matches the prior period's closing balance.`
          : `This period's opening balance (${bank.openingBalance ?? "n/a"}) does not match the prior period's closing balance (${expectedOpeningBalance})${
              continuityDiff !== null
                ? ` — a difference of ${continuityDiff > 0 ? "+" : ""}${continuityDiff.toFixed(2)}.`
                : "."
            }`,
        severity: ok ? "low" : "high",
        points: ok ? CHECK_POINTS.openingBalanceContinuity : 0,
        maxPoints: CHECK_POINTS.openingBalanceContinuity,
      });
      if (!ok) {
        recommendations.push(
          "Investigate why this period's opening balance doesn't roll forward from last period's closing balance.",
        );
      }
    }
  }

  const ledgerDebitTotal = sumByType(ledger.transactions, "debit");
  const ledgerCreditTotal = sumByType(ledger.transactions, "credit");
  const bankDebitTotal = sumByType(bank.transactions, "debit");
  const bankCreditTotal = sumByType(bank.transactions, "credit");

  // 3. Debits reconcile: ledger debits vs bank credits (inflows)
  const debitsRule = ruleEnabled(rules, "debitsReconcile");
  if (debitsRule) {
    const tolerance = debitsRule.tolerance ?? defaultTolerance;
    const ok = withinTolerance(ledgerDebitTotal, bankCreditTotal, tolerance);
    checklist.push({
      title: "Total Debit equals Bank Credits",
      status: ok ? "pass" : "fail",
      explanation: `Ledger debit total ${ledgerDebitTotal.toFixed(2)} vs bank credit total ${bankCreditTotal.toFixed(2)}.`,
      severity: ok ? "low" : "high",
      points: ok ? CHECK_POINTS.debitsReconcile : 0,
      maxPoints: CHECK_POINTS.debitsReconcile,
    });
  }

  // 4. Credits reconcile: ledger credits vs bank debits (outflows)
  const creditsRule = ruleEnabled(rules, "creditsReconcile");
  if (creditsRule) {
    const tolerance = creditsRule.tolerance ?? defaultTolerance;
    const ok = withinTolerance(ledgerCreditTotal, bankDebitTotal, tolerance);
    checklist.push({
      title: "Total Credit equals Bank Debits",
      status: ok ? "pass" : "fail",
      explanation: `Ledger credit total ${ledgerCreditTotal.toFixed(2)} vs bank debit total ${bankDebitTotal.toFixed(2)}.`,
      severity: ok ? "low" : "high",
      points: ok ? CHECK_POINTS.creditsReconcile : 0,
      maxPoints: CHECK_POINTS.creditsReconcile,
    });
  }

  // 5. Duplicate entries within the ledger
  const duplicatesRule = ruleEnabled(rules, "duplicates");
  if (duplicatesRule) {
    const duplicates = findDuplicates(ledger.transactions);
    const ok = duplicates.length === 0;
    checklist.push({
      title: "Duplicate Transactions",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? "No duplicate ledger entries found."
        : `${duplicates.length} duplicate ledger entr${duplicates.length === 1 ? "y" : "ies"} found.`,
      severity: ok ? "low" : "medium",
      points: ok ? CHECK_POINTS.duplicates : 0,
      maxPoints: CHECK_POINTS.duplicates,
    });
    if (!ok) recommendations.push("Remove or explain duplicate ledger entries.");
  }

  // Match ledger <-> bank transactions (ledger debit <-> bank credit, ledger credit <-> bank debit).
  const ledgerDebits = ledger.transactions.filter((t) => t.type === "debit");
  const ledgerCredits = ledger.transactions.filter((t) => t.type === "credit");
  const bankDebits = bank.transactions.filter((t) => t.type === "debit");
  const bankCredits = bank.transactions.filter((t) => t.type === "credit");
  const tolerance = defaultTolerance;

  const { unmatched: unmatchedLedgerDebits } = matchAgainst(ledgerDebits, bankCredits, tolerance);
  const { unmatched: unmatchedLedgerCredits } = matchAgainst(ledgerCredits, bankDebits, tolerance);
  const { unmatched: unmatchedBankCredits } = matchAgainst(bankCredits, ledgerDebits, tolerance);
  const { unmatched: unmatchedBankDebits } = matchAgainst(bankDebits, ledgerCredits, tolerance);

  const statementLatestDate = latestDate([...bank.transactions, ...ledger.transactions]);

  // 6. Missing entries: bank transactions with no ledger counterpart and no charge/interest explanation.
  const missingRule = ruleEnabled(rules, "missingEntries");
  const unexplainedBank = [...unmatchedBankCredits, ...unmatchedBankDebits].filter(
    (t) => !CHARGE_KEYWORDS.test(t.description) && !INTEREST_KEYWORDS.test(t.description),
  );
  if (missingRule) {
    const ok = unexplainedBank.length === 0;
    checklist.push({
      title: "Missing Transactions",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? "Every bank transaction is reflected in the ledger."
        : `${unexplainedBank.length} bank transaction(s) are not recorded in the ledger.`,
      severity: ok ? "low" : "critical",
      points: ok ? CHECK_POINTS.missingEntries : 0,
      maxPoints: CHECK_POINTS.missingEntries,
    });
    if (!ok) recommendations.push("Record the missing bank transactions in the ledger.");
  }

  // Split unmatched ledger entries into recent (still-clearing) vs stale (unexplained).
  const recentLedgerDebits = unmatchedLedgerDebits.filter(
    (t) => daysBetween(t.date, statementLatestDate) <= OUTSTANDING_WINDOW_DAYS,
  );
  const staleLedgerDebits = unmatchedLedgerDebits.filter(
    (t) => daysBetween(t.date, statementLatestDate) > OUTSTANDING_WINDOW_DAYS,
  );
  const recentLedgerCredits = unmatchedLedgerCredits.filter(
    (t) => daysBetween(t.date, statementLatestDate) <= OUTSTANDING_WINDOW_DAYS,
  );
  const staleLedgerCredits = unmatchedLedgerCredits.filter(
    (t) => daysBetween(t.date, statementLatestDate) > OUTSTANDING_WINDOW_DAYS,
  );

  // 7. Outstanding cheques: recent ledger credits (payments) not yet cleared by the bank.
  const outstandingRule = ruleEnabled(rules, "outstandingCheques");
  if (outstandingRule) {
    checklist.push({
      title: "Outstanding Cheques",
      status: "pass",
      explanation:
        recentLedgerCredits.length === 0
          ? "No outstanding cheques."
          : `${recentLedgerCredits.length} payment(s) recorded in the ledger have not yet cleared the bank — expected for recent activity.`,
      severity: "low",
      points: CHECK_POINTS.outstandingCheques,
      maxPoints: CHECK_POINTS.outstandingCheques,
    });
  }

  // 8. Deposits in transit: recent ledger debits (receipts) not yet cleared by the bank.
  const depositsRule = ruleEnabled(rules, "depositsInTransit");
  if (depositsRule) {
    checklist.push({
      title: "Deposits in Transit",
      status: "pass",
      explanation:
        recentLedgerDebits.length === 0
          ? "No deposits in transit."
          : `${recentLedgerDebits.length} deposit(s) recorded in the ledger have not yet cleared the bank — expected for recent activity.`,
      severity: "low",
      points: CHECK_POINTS.depositsInTransit,
      maxPoints: CHECK_POINTS.depositsInTransit,
    });
  }

  // 9. Bank charges accounted for
  const chargesRule = ruleEnabled(rules, "bankCharges");
  if (chargesRule) {
    const unexplainedCharges = unmatchedBankDebits.filter((t) => CHARGE_KEYWORDS.test(t.description));
    const ok = unexplainedCharges.length === 0;
    checklist.push({
      title: "Bank Charges Accounted For",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? "All bank charges are reflected in the ledger."
        : `${unexplainedCharges.length} bank charge(s) are missing from the ledger.`,
      severity: ok ? "low" : "medium",
      points: ok ? CHECK_POINTS.bankCharges : 0,
      maxPoints: CHECK_POINTS.bankCharges,
    });
    if (!ok) recommendations.push("Record outstanding bank charges/fees in the ledger.");
  }

  // 10. Interest accounted for
  const interestRule = ruleEnabled(rules, "interest");
  if (interestRule) {
    const unexplainedInterest = [...unmatchedBankDebits, ...unmatchedBankCredits].filter((t) =>
      INTEREST_KEYWORDS.test(t.description),
    );
    const ok = unexplainedInterest.length === 0;
    checklist.push({
      title: "Interest Accounted For",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? "All interest transactions are reflected in the ledger."
        : `${unexplainedInterest.length} interest transaction(s) are missing from the ledger.`,
      severity: ok ? "low" : "medium",
      points: ok ? CHECK_POINTS.interest : 0,
      maxPoints: CHECK_POINTS.interest,
    });
    if (!ok) recommendations.push("Record outstanding interest transactions in the ledger.");
  }

  // 11. Unknown transactions: stale ledger entries that never cleared and aren't explained.
  const unknownRule = ruleEnabled(rules, "unknownTransactions");
  if (unknownRule) {
    const unknown = [...staleLedgerDebits, ...staleLedgerCredits];
    const ok = unknown.length === 0;
    checklist.push({
      title: "Unknown Transactions",
      status: ok ? "pass" : "fail",
      explanation: ok
        ? "No unexplained stale ledger entries."
        : `${unknown.length} ledger entr${unknown.length === 1 ? "y" : "ies"} could not be matched to the bank statement and are older than ${OUTSTANDING_WINDOW_DAYS} days.`,
      severity: ok ? "low" : "medium",
      points: ok ? CHECK_POINTS.unknownTransactions : 0,
      maxPoints: CHECK_POINTS.unknownTransactions,
    });
    if (!ok) recommendations.push("Investigate stale ledger entries with no matching bank activity.");
  }

  const totalMax = checklist.reduce((sum, c) => sum + c.maxPoints, 0);
  const totalEarned = checklist.reduce((sum, c) => sum + c.points, 0);
  const score = totalMax === 0 ? 100 : Math.round((totalEarned / totalMax) * 100);

  const failCount = checklist.filter((c) => c.status === "fail").length;
  const summary =
    failCount === 0
      ? "All reconciliation checks passed."
      : `${failCount} check${failCount === 1 ? "" : "s"} failed — review the checklist for details.`;

  return { score, checklist, summary, recommendations };
}

export async function bankReconciliationValidator(
  files: ParsedFile[],
  rules: ValidationRule[],
  context: ValidationContext,
): Promise<ValidationResult> {
  const ledgerFile = files.find((f) => f.label.toLowerCase().includes("ledger"));
  const bankFile = files.find((f) => f.label.toLowerCase().includes("bank"));

  if (!ledgerFile || !bankFile) {
    return {
      score: 0,
      checklist: [
        {
          title: "Required files present",
          status: "fail",
          explanation: "Both a ledger and a bank statement file are required to run reconciliation.",
          severity: "critical",
          points: 0,
          maxPoints: 100,
        },
      ],
      summary: "Validation could not run — missing required files.",
      recommendations: ["Upload both the internal ledger and the bank statement."],
    };
  }

  const ledgerStatement = sliceStatementToPeriod(ledgerFile.statement, context.periodStart, context.periodEnd);
  const bankStatement = sliceStatementToPeriod(bankFile.statement, context.periodStart, context.periodEnd);

  const result = runBankReconciliationChecks(ledgerStatement, bankStatement, rules, context.expectedOpeningBalance);
  return {
    ...result,
    carryForward: bankStatement.closingBalance !== null ? { closingBalance: bankStatement.closingBalance } : undefined,
  };
}
