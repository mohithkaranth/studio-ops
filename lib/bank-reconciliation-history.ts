import "server-only";
import { sql } from "@/lib/db";
import { ensureBankAllocationTables, readBankAllocations } from "@/lib/bank-allocations";
import { reconcileStripeBookings } from "@/lib/stripe/reconciliation";
import { monthRange } from "@/lib/stripe/reconciliation-model";

export type HistoryMonth = {
  year: number; month: number; status: "pending" | "running" | "complete" | "partial" | "failed";
  bookings: number; issues: number; confirmedCredits: number; confirmedCents: number;
  message: string | null;
};

async function sourceFingerprint() {
  const rows = await sql<{ fingerprint: string }[]>`select md5('paynow-matched-v2:' ||
    coalesce((select string_agg(id::text || ':' || file_hash, ',' order by id) from bank_statement_uploads), '') || ':' ||
    coalesce((select string_agg(md5(concat_ws('|', acuity_appointment_id::text, price::text,
      appointment_datetime::text, created_datetime::text, certificate_code, canceled::text, raw_json::text)), ','
      order by acuity_appointment_id) from acuity_appointments
      where appointment_datetime >= '2026-01-01T00:00:00+08:00'::timestamptz), '')
    ) as fingerprint`;
  return rows[0].fingerprint;
}

export async function getBankHistory(year: number, month: number) {
  monthRange(year, month);
  await ensureBankAllocationTables();
  const fingerprint = await sourceFingerprint();
  const stored = await sql<(HistoryMonth & { source_fingerprint: string })[]>`
    select year, month, status, bookings, issues, confirmed_credits as "confirmedCredits",
      confirmed_cents::float8 as "confirmedCents", message, source_fingerprint
    from bank_reconciliation_history where year * 12 + month <= ${year * 12 + month}
  `;
  const months: HistoryMonth[] = [];
  for (let value = 2026 * 12 + 1; value <= year * 12 + month; value++) {
    const periodYear = Math.floor((value - 1) / 12);
    const periodMonth = (value - 1) % 12 + 1;
    const saved = stored.find(item => item.year === periodYear && item.month === periodMonth);
    months.push(saved && saved.source_fingerprint === fingerprint
      ? { ...saved, confirmedCents: Number(saved.confirmedCents) }
      : { year: periodYear, month: periodMonth, status: "pending", bookings: 0, issues: 0,
        confirmedCredits: 0, confirmedCents: 0, message: saved ? "Source data changed; recheck this month." : null });
  }
  const allocations = await readBankAllocations();
  const matched = await sql<{ count: number }[]>`select count(distinct transaction_key)::int as count from bank_paynow_matches`;
  return { matchedCredits: matched[0].count, months, complete: months.every(item => item.status === "complete"),
    allocatedCents: allocations.reduce((sum, item) => sum + item.cents, 0),
    allocatedCredits: new Set(allocations.map(item => item.transactionKey)).size };
}

export async function backfillBankMonth(year: number, month: number) {
  monthRange(year, month);
  await ensureBankAllocationTables();
  const fingerprint = await sourceFingerprint();
  const started = await sql`insert into bank_reconciliation_history (year, month, status, source_fingerprint)
    values (${year}, ${month}, 'running', ${fingerprint})
    on conflict (year, month) do update set status = 'running', source_fingerprint = excluded.source_fingerprint,
      started_at = now(), finished_at = null, message = null
    where bank_reconciliation_history.status <> 'running'
      or bank_reconciliation_history.started_at < now() - interval '6 minutes'
    returning year`;
  if (!started.length) throw new Error("This month's history check is already running. Try again shortly.");
  try {
    const rows = await reconcileStripeBookings(year, month);
    const issues = rows.filter(row => row.status === "Unable to check" && !row.note?.includes("Stripe payment is linked to multiple bookings")).length;
    const changed = await sourceFingerprint() !== fingerprint;
    const allocations = (await readBankAllocations()).filter(item => rows.some(row => row.appointmentId === item.appointmentId));
    const confirmedCredits = new Set(allocations.map(item => item.transactionKey)).size;
    const confirmedCents = allocations.reduce((sum, item) => sum + item.cents, 0);
    const status = issues || changed ? "partial" : "complete";
    const review = rows.filter(row => row.bankMatch.bankStatus === "Review").length;
    const message = changed ? "Source data changed during the check. Run this month again."
      : `${confirmedCredits} saved credits; ${review} PayNow matched bookings (accounted for)${issues ? `; ${issues} payment checks failed` : ''}.`;
    await sql`update bank_reconciliation_history set status = ${status}, bookings = ${rows.length},
      issues = ${issues}, confirmed_credits = ${confirmedCredits}, confirmed_cents = ${confirmedCents},
      finished_at = now(), message = ${message} where year = ${year} and month = ${month}`;
    return { year, month, status, bookings: rows.length, issues, confirmedCredits, confirmedCents, message };
  } catch (error) {
    await sql`update bank_reconciliation_history set status = 'failed', finished_at = now(),
      message = 'The month could not be checked. Retry to resume; saved confirmations remain intact.'
      where year = ${year} and month = ${month}`;
    throw error;
  }
}
