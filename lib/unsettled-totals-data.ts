import "server-only";
import { sql } from "@/lib/db";
import { sgdCents } from "@/lib/stripe/reconciliation-model";
import type { ReconciliationRow } from "@/lib/stripe/reconciliation";
import { unsettledTotals } from "@/lib/unsettled-totals";
import { bankTransactionKey, ensureBankAllocationTables } from "@/lib/bank-allocations";

export async function getUnsettledTotals(rows: ReconciliationRow[]) {
  await ensureBankAllocationTables();
  const excluded = new Set<string>();
  const initial = unsettledTotals(rows, [], excluded);
  if (!initial.windows.length) return initial;
  const from = initial.windows.reduce((day, window) => window.from < day ? window.from : day, initial.windows[0].from);
  const to = initial.windows.reduce((day, window) => window.to > day ? window.to : day, initial.windows[0].to);
  const credits = await sql<{ id: string; date: string; credit: string }[]>`
    SELECT DISTINCT ON (${bankTransactionKey}) ${bankTransactionKey} AS id,
      t.transaction_date::date::text AS date,
      ((round(t.credit * 100)::bigint - coalesce((select sum(a.allocated_cents)
        from bank_payment_allocations a where a.transaction_key = ${bankTransactionKey}
          and a.released_at is null), 0)) / 100.0)::text AS credit
    FROM bank_transactions t
    JOIN bank_statement_uploads u ON u.id = t.upload_id
    WHERE t.credit > 0 AND COALESCE(t.debit, 0) = 0 AND UPPER(u.currency) = 'SGD'
      AND (t.description_1 ILIKE '%paynow%' OR t.description_2 ILIKE '%paynow%')
      AND t.transaction_date >= ${from}::date AND t.transaction_date < (${to}::date + 1)
    ORDER BY ${bankTransactionKey}, t.id
  `;
  return unsettledTotals(rows, credits.map(credit => {
    const cents = sgdCents(credit.credit);
    if (cents === null) throw new Error("Invalid PayNow credit amount.");
    return { id: credit.id, date: credit.date, cents };
  }), excluded);
}
