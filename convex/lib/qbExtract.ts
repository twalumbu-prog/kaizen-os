/**
 * Utilities for extracting account-specific rows from a QB TransactionList response.
 *
 * QB TransactionList known limitation:
 *   For transfers between a bank account and a non-bank account (e.g. Loan
 *   Receivables, Loan Payable), the API only returns the non-bank side of the
 *   transfer.  The bank-account side is simply absent.  The BalanceSheet API,
 *   however, correctly accounts for both sides — so if we blindly sum the
 *   TransactionList rows we get a running balance that diverges from QB's own
 *   balance sheet.
 *
 * Fix (two-pass):
 *   1. Collect (txNum, date, negatedAmount) signatures of all rows that already
 *      name the target bank account directly (col[6] === accountName).
 *   2. For every Transfer row where
 *        • col[7] (split/counterparty) === accountName, and
 *        • col[6] (account) does NOT start with "Banks:" (non-bank counterparty), and
 *        • the synthesised amount cannot be matched to an already-captured direct row
 *      synthesise a missing bank-account row by negating the displayed amount.
 *      (If acct were another bank account QB would always emit both sides, so
 *      we'd double-count if we also synthesised it — hence the "Banks:" guard.)
 *
 * Deduplication note:
 *   QB Transfers sometimes lack a transaction number (col[2] = "").  To avoid
 *   double-counting when no txNum is available we fall back to a
 *   date + negated-amount signature check against the direct rows collected in
 *   pass 1.
 */
export function extractAccountRows(
  rows: any[],
  accountName: string,
): Array<{ date: string; description: string; amount: number }> {
  // Pass 1: build two deduplication structures from rows that directly name this
  // account (col[6] === accountName).
  //   directTxNums  — non-empty transaction numbers (col[2]) for quick O(1) lookup.
  //   directSigs    — "date|negatedAmt" signatures for rows whose txNum is empty,
  //                   used as a fallback so we don't synthesise a row that was
  //                   already captured directly.
  const directTxNums = new Set<string>();
  const directSigs = new Set<string>(); // "YYYY-MM-DD|-amount"
  for (const row of rows) {
    const cols = row.ColData;
    if (!cols || cols.length < 9) continue;
    if (cols[6]?.value !== accountName) continue;
    const txNum: string = cols[2]?.value ?? "";
    const date: string = cols[0]?.value ?? "";
    const amt = parseFloat(cols[8]?.value ?? "0");
    if (txNum) {
      directTxNums.add(txNum);
    } else if (Number.isFinite(amt) && amt !== 0) {
      // Store the negated amount — synthesis negates, so this cancels out:
      // direct row amt=+5000 → sig "date|-5000" matches synthesis amt=-5000 → -(-5000)=+5000
      directSigs.add(`${date}|${-amt}`);
    }
  }

  // Pass 2: collect all rows that affect this account (direct + synthesised)
  const result: Array<{ date: string; description: string; amount: number }> = [];

  for (const row of rows) {
    const cols = row.ColData;
    if (!cols || cols.length < 9) continue;

    const acct: string = cols[6]?.value ?? "";
    const split: string = cols[7]?.value ?? "";
    const type: string = cols[1]?.value ?? "";
    const amtStr: string = cols[8]?.value ?? "0";
    const amount = parseFloat(amtStr);
    if (!Number.isFinite(amount) || amount === 0) continue;

    const date: string = cols[0]?.value ?? "";
    const txNum: string = cols[2]?.value ?? "";
    const description =
      [cols[4]?.value, cols[5]?.value].filter(Boolean).join(" — ") ||
      type ||
      "Transaction";

    if (acct === accountName) {
      // Direct row — this account is the primary account on the transaction line.
      result.push({ date, description, amount });
    } else if (
      type === "Transfer" &&
      split === accountName &&
      !acct.startsWith("Banks:")
    ) {
      // Potential QB-omitted target-account side for this non-bank Transfer.
      // Deduplicate: skip if the target account already has a direct row for this
      // transaction (by txNum, or by date+negated-amount when txNum is absent).
      const alreadyCaptured =
        (txNum !== "" && directTxNums.has(txNum)) ||
        (txNum === "" && directSigs.has(`${date}|${amount}`));
      if (!alreadyCaptured) {
        // Synthesise the missing row: ZANACO's cash effect = negation of what the
        // counterparty side shows (e.g. Loan Receivables -5 000 → ZANACO +5 000).
        result.push({
          date,
          description: `Transfer — ${acct}`,
          amount: -amount,
        });
      }
    }
  }

  // Ensure chronological order so the running-balance chain is correct.
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
}
