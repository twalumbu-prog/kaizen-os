import { describe, expect, it } from "vitest";
import { runBankReconciliationChecks } from "./bankReconciliation";
import type { Transaction, ValidationRule } from "./types";

const ALL_RULES: ValidationRule[] = [
  { key: "openingBalance", label: "Opening balance must match", enabled: true, tolerance: 0.01 },
  { key: "closingBalance", label: "Closing balance must match", enabled: true, tolerance: 0.01 },
  { key: "debitsReconcile", label: "Debit total equals bank inflows", enabled: true },
  { key: "creditsReconcile", label: "Credit total equals bank outflows", enabled: true },
  { key: "duplicates", label: "Duplicate Transactions", enabled: true },
  { key: "missingEntries", label: "Missing Transactions", enabled: true },
  { key: "outstandingCheques", label: "Outstanding Cheques", enabled: true },
  { key: "depositsInTransit", label: "Deposits in Transit", enabled: true },
  { key: "bankCharges", label: "Bank Charges Accounted For", enabled: true },
  { key: "interest", label: "Interest Accounted For", enabled: true },
  { key: "unknownTransactions", label: "Unknown Transactions", enabled: true },
];

function tx(partial: Partial<Transaction> & Pick<Transaction, "date" | "amount" | "type">): Transaction {
  return { description: "", ...partial };
}

describe("runBankReconciliationChecks", () => {
  it("passes every check for a clean, fully-matched reconciliation", () => {
    const ledger = {
      openingBalance: 1000,
      closingBalance: 1300,
      transactions: [
        tx({ date: "2026-06-01", description: "Client payment", amount: 500, type: "debit" }),
        tx({ date: "2026-06-02", description: "Rent", amount: 200, type: "credit" }),
      ],
    };
    const bank = {
      openingBalance: 1000,
      closingBalance: 1300,
      transactions: [
        tx({ date: "2026-06-01", description: "Client payment", amount: 500, type: "credit" }),
        tx({ date: "2026-06-02", description: "Rent", amount: 200, type: "debit" }),
      ],
    };

    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES);

    expect(result.score).toBe(100);
    expect(result.checklist.every((c) => c.status === "pass")).toBe(true);
  });

  it("fails opening/closing balance checks when they diverge", () => {
    const ledger = { openingBalance: 1000, closingBalance: 1300, transactions: [] as Transaction[] };
    const bank = { openingBalance: 900, closingBalance: 1250, transactions: [] as Transaction[] };

    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES);

    const opening = result.checklist.find((c) => c.title === "Opening balances match");
    const closing = result.checklist.find((c) => c.title === "Closing balances match");
    expect(opening?.status).toBe("fail");
    expect(closing?.status).toBe("fail");
    expect(result.score).toBeLessThan(100);
  });

  it("flags duplicate ledger entries", () => {
    const duplicateTx = tx({ date: "2026-06-01", description: "Office supplies", amount: 50, type: "credit" });
    const ledger = {
      openingBalance: 1000,
      closingBalance: 950,
      transactions: [duplicateTx, { ...duplicateTx }],
    };
    const bank = { openingBalance: 1000, closingBalance: 900, transactions: [] as Transaction[] };

    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES);
    const duplicates = result.checklist.find((c) => c.title === "Duplicate Transactions");
    expect(duplicates?.status).toBe("fail");
  });

  it("flags bank transactions missing from the ledger", () => {
    const ledger = { openingBalance: 1000, closingBalance: 1000, transactions: [] as Transaction[] };
    const bank = {
      openingBalance: 1000,
      closingBalance: 1300,
      transactions: [tx({ date: "2026-06-01", description: "Wire transfer", amount: 300, type: "credit" })],
    };

    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES);
    const missing = result.checklist.find((c) => c.title === "Missing Transactions");
    expect(missing?.status).toBe("fail");
  });

  it("passes bank charges as outstanding when unmatched but flags them if the rule requires ledger entries", () => {
    const ledger = { openingBalance: 1000, closingBalance: 970, transactions: [] as Transaction[] };
    const bank = {
      openingBalance: 1000,
      closingBalance: 970,
      transactions: [tx({ date: "2026-06-01", description: "Monthly service charge", amount: 30, type: "debit" })],
    };

    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES);
    const charges = result.checklist.find((c) => c.title === "Bank Charges Accounted For");
    expect(charges?.status).toBe("fail");
  });

  it("treats recent unmatched ledger entries as outstanding, not unknown", () => {
    const recentDate = "2026-06-10";
    const ledger = {
      openingBalance: 1000,
      closingBalance: 1200,
      transactions: [tx({ date: recentDate, description: "Cheque #100", amount: 200, type: "credit" })],
    };
    const bank = {
      openingBalance: 1000,
      closingBalance: 1000,
      transactions: [tx({ date: recentDate, description: "unrelated", amount: 0, type: "debit" })].filter(
        (t) => t.amount > 0,
      ),
    };

    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES);
    const outstanding = result.checklist.find((c) => c.title === "Outstanding Cheques");
    const unknown = result.checklist.find((c) => c.title === "Unknown Transactions");
    expect(outstanding?.status).toBe("pass");
    expect(unknown?.status).toBe("pass");
  });

  it("only runs checks for enabled rules", () => {
    const rules = ALL_RULES.filter((r) => r.key !== "duplicates");
    const ledger = { openingBalance: 1000, closingBalance: 1000, transactions: [] as Transaction[] };
    const bank = { openingBalance: 1000, closingBalance: 1000, transactions: [] as Transaction[] };

    const result = runBankReconciliationChecks(ledger, bank, rules);
    expect(result.checklist.find((c) => c.title === "Duplicate Transactions")).toBeUndefined();
  });
});

describe("opening balance continuity", () => {
  const RULES_WITH_CONTINUITY: ValidationRule[] = [
    ...ALL_RULES,
    { key: "openingBalanceContinuity", label: "Opening balance continuity", enabled: true, tolerance: 0.01 },
  ];
  const ledger = { openingBalance: 1000, closingBalance: 1000, transactions: [] as Transaction[] };
  const bank = { openingBalance: 1000, closingBalance: 1000, transactions: [] as Transaction[] };

  it("passes gracefully when there's no prior period to compare against", () => {
    const result = runBankReconciliationChecks(ledger, bank, RULES_WITH_CONTINUITY, null);
    const continuity = result.checklist.find((c) => c.title === "Opening Balance Continuity");
    expect(continuity?.status).toBe("pass");
    expect(continuity?.explanation).toMatch(/no prior period/i);
  });

  it("passes when this period's opening balance matches last period's closing balance", () => {
    const result = runBankReconciliationChecks(ledger, bank, RULES_WITH_CONTINUITY, 1000);
    const continuity = result.checklist.find((c) => c.title === "Opening Balance Continuity");
    expect(continuity?.status).toBe("pass");
  });

  it("fails and reports the difference when the opening balance doesn't roll forward", () => {
    const result = runBankReconciliationChecks(ledger, bank, RULES_WITH_CONTINUITY, 950);
    const continuity = result.checklist.find((c) => c.title === "Opening Balance Continuity");
    expect(continuity?.status).toBe("fail");
    expect(continuity?.explanation).toContain("+50.00");
  });

  it("is not run when the rule is disabled", () => {
    const result = runBankReconciliationChecks(ledger, bank, ALL_RULES, 950);
    expect(result.checklist.find((c) => c.title === "Opening Balance Continuity")).toBeUndefined();
  });
});
