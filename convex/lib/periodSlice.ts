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
): ParsedStatement {
  const dated = statement.transactions
    .map((t) => ({ t, ts: toTimestamp(t.date) }))
    .filter((x) => !Number.isNaN(x.ts))
    .sort((a, b) => a.ts - b.ts);

  const inWindow = dated.filter((x) => x.ts >= periodStart && x.ts <= periodEnd).map((x) => x.t);

  const before = dated.filter((x) => x.ts < periodStart && x.t.balanceAfter !== undefined);
  const openingBalance =
    before.length > 0 ? before[before.length - 1].t.balanceAfter! : statement.openingBalance;

  const throughPeriodEnd = dated.filter((x) => x.ts <= periodEnd && x.t.balanceAfter !== undefined);
  const closingBalance =
    throughPeriodEnd.length > 0
      ? throughPeriodEnd[throughPeriodEnd.length - 1].t.balanceAfter!
      : statement.closingBalance;

  return { openingBalance, closingBalance, transactions: inWindow };
}
