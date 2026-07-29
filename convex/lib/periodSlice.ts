import type { ParsedStatement } from "../validators/types";

function toTimestamp(dateStr: string): number {
  return new Date(dateStr).getTime();
}

/**
 * Scopes a (possibly multi-period) statement down to just one period's
 * window. Employees often export more than one period's worth of data at
 * once (e.g. a full month for a weekly report); this derives the target
 * period's own opening/closing balances from the nearest `balanceAfter`
 * anchors rather than trusting the whole file's stated totals.
 */
export function sliceStatementToPeriod(
  statement: ParsedStatement,
  periodStart: number,
  periodEnd: number,
  role?: "ledger" | "bank"
): ParsedStatement {
  const dated = statement.transactions
    .map((t) => ({ t, ts: toTimestamp(t.date) }))
    .filter((x) => !Number.isNaN(x.ts))
    .sort((a, b) => a.ts - b.ts);

  // If there's an opening balance but no balanceAfter on transactions, derive them.
  if (statement.openingBalance !== null && role) {
    let currentBalance = statement.openingBalance;
    for (const x of dated) {
      if (x.t.balanceAfter === undefined) {
        if (role === "ledger") {
          currentBalance += x.t.type === "debit" ? x.t.amount : -x.t.amount;
        } else {
          currentBalance += x.t.type === "credit" ? x.t.amount : -x.t.amount;
        }
        x.t.balanceAfter = currentBalance;
      } else {
        currentBalance = x.t.balanceAfter;
      }
    }
  }

  const inWindow = dated.filter((x) => x.ts >= periodStart && x.ts <= periodEnd).map((x) => x.t);

  const before = dated.filter((x) => x.ts < periodStart && x.t.balanceAfter !== undefined);
  const openingBalance =
    before.length > 0 ? before[before.length - 1].t.balanceAfter! : statement.openingBalance;

  const throughPeriodEnd = dated.filter((x) => x.ts <= periodEnd && x.t.balanceAfter !== undefined);
  let closingBalance: number | null;
  if (throughPeriodEnd.length > 0) {
    closingBalance = throughPeriodEnd[throughPeriodEnd.length - 1].t.balanceAfter!;
  } else if (statement.openingBalance !== null && role && dated.length > 0) {
    closingBalance = statement.openingBalance;
  } else {
    closingBalance = statement.closingBalance;
  }

  return { openingBalance, closingBalance, transactions: inWindow };
}
