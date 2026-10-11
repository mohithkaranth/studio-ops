import "server-only";
import { sql } from "@/lib/db";
import { sgdCents } from "@/lib/stripe/reconciliation-model";
import type { ReconciliationRow } from "@/lib/stripe/reconciliation";
import { unsettledTotals } from "@/lib/unsettled-totals";

export async function getUnsettledTotals(rows: ReconciliationRow[], allRows: ReconciliationRow[]) {
  const excluded = new Set(allRows.flatMap(row => row.bankMatch.bankStatus === "Confirmed"
    ? row.bankMatch.candidates.filter(candidate => candidate.reason === "Booking reference" && !candidate.shared)
      .map(candidate => candidate.transactionId) : []));
  const initial = unsettledTotals(rows, [], excluded);
  if (!initial.windows.length) return initial;
  const from = initial.windows.reduce((day, window) => window.from < day ? window.from : day, initial.windows[0].from);
  const to = initial.windows.reduce((day, window) => window.to > day ? window.to : day, initial.windows[0].to);
  const credits = await sql<{ id: string; date: string; credit: string }[]>`
    SELECT t.id::text AS id, t.transaction_date::date::text AS date, t.credit::text
    FROM bank_transactions t
    JOIN bank_statement_uploads u ON u.id = t.upload_id
    WHERE t.credit > 0 AND COALESCE(t.debit, 0) = 0 AND UPPER(u.currency) = 'SGD'
      AND (t.description_1 ILIKE '%paynow%' OR t.description_2 ILIKE '%paynow%')
      AND t.transaction_date >= ${from}::date AND t.transaction_date < (${to}::date + 1)
      -- Confirmations are currently derived from explicit booking references, not a saved ledger.
      -- Reserve referenced transfers across ALL booking periods, including ambiguous references,
      -- so a previously allocated payment cannot enter this unaccounted pool.
      AND NOT EXISTS (
        SELECT 1 FROM acuity_appointments a
        WHERE a.acuity_appointment_id::text ~ '^[0-9]+$'
          AND CONCAT_WS(' ', t.description_1, t.description_2)
            ~ ('(^|[^0-9])' || a.acuity_appointment_id::text || '([^0-9]|$)')
      )
    ORDER BY t.transaction_date, t.id
  `;
  return unsettledTotals(rows, credits.map(credit => {
    const cents = sgdCents(credit.credit);
    if (cents === null) throw new Error("Invalid PayNow credit amount.");
    return { id: credit.id, date: credit.date, cents };
  }), excluded);
}
