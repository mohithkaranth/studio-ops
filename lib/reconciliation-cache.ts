import 'server-only';
import { sql } from '@/lib/db';
import { ensureBankAllocationTables } from '@/lib/bank-allocations';
import { reconcileStripeBookings, type ReconciliationRow } from '@/lib/stripe/reconciliation';
import { getReconciliationPeriods } from '@/lib/reconciliation-period-data';
import { displayReconciliationStatus } from '@/lib/reconciliation-status';
import { getUnsettledTotals } from '@/lib/unsettled-totals-data';
import { monthRange } from '@/lib/stripe/reconciliation-model';

export async function ensureReconciliationCache() {
  await ensureBankAllocationTables();
  await sql`create table if not exists reconciliation_month_snapshots (
    year integer not null, month integer not null, fingerprint text not null,
    rows jsonb not null, checked_at timestamptz not null default now(), primary key(year, month)
  )`;
}
export async function monthFingerprint(year: number, month: number) {
  const range = monthRange(year, month);
  const records = await sql<{ fingerprint: string }[]>`select md5('snapshot-v1-ignored-sources:' ||
    coalesce((select string_agg(id::text || ':' || file_hash, ',' order by id) from bank_statement_uploads), '') || ':' ||
    coalesce((select string_agg(md5(concat_ws('|', acuity_appointment_id::text, price::text, appointment_datetime::text,
      created_datetime::text, certificate_code, canceled::text, raw_json::text)), ',' order by acuity_appointment_id)
      from acuity_appointments where appointment_datetime >= ${range.from}::timestamptz and appointment_datetime < ${range.to}::timestamptz), '') || ':' ||
    coalesce((select string_agg(concat_ws('|',transaction_key,appointment_id,allocated_cents::text,released_at::text), ','
      order by transaction_key,appointment_id) from bank_payment_allocations), '')
    ) as fingerprint`;
  return records[0].fingerprint;
}
export async function loadReconciliationMonth(year: number, month: number, force = false) {
  await ensureReconciliationCache();
  const fingerprint = await monthFingerprint(year, month);
  const saved = await sql<{ rows: ReconciliationRow[]; fingerprint: string }[]>`select rows, fingerprint from reconciliation_month_snapshots where year=${year} and month=${month}`;
  if (!force && saved[0]?.fingerprint === fingerprint) return { rows: saved[0].rows, cached: true };
  const rows = await reconcileStripeBookings(year, month);
  // Save the initial fingerprint: source changes during the check must trigger
  // another check, rather than being mistaken for the state we actually read.
  await sql`insert into reconciliation_month_snapshots(year,month,fingerprint,rows)
    values(${year},${month},${fingerprint},${sql.json(rows)})
    on conflict(year,month) do update set fingerprint=excluded.fingerprint, rows=excluded.rows, checked_at=now()`;
  return { rows, cached: false };
}
export async function getSavedUnsettledYear(year: number) {
  await ensureReconciliationCache();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const months = (await getReconciliationPeriods()).filter(p => p.year === year && (year < Number(today.slice(0,4)) || p.month <= Number(today.slice(5,7)))).map(p => p.month).sort((a,b)=>a-b);
  const saved = await sql<{ month: number; rows: ReconciliationRow[]; fingerprint: string; checkedAt: string }[]>`select month, rows, fingerprint, checked_at::text as "checkedAt" from reconciliation_month_snapshots where year=${year}`;
  const missingMonths: number[] = [];
  for (const month of months) {
    const record = saved.find(item=>item.month===month);
    if (!record || record.fingerprint !== await monthFingerprint(year,month)) missingMonths.push(month);
  }
  const selected = saved.filter(item=>months.includes(item.month));
  const allRows = selected.flatMap(item=>item.rows).filter(row=>new Date(row.appointmentDate).getTime() <= Date.now());
  const rows = allRows.filter(row=>displayReconciliationStatus(row)==='No settlement');
  const complete = months.every(month=>selected.some(item=>item.month===month));
  return { year, rows, totals: complete ? await getUnsettledTotals(rows) : null,
    unchecked: allRows.filter(row=>displayReconciliationStatus(row)==='Unable to check').length,
    missingMonths, stale: missingMonths.length > 0, months,
    checkedAt: selected.length ? selected.map(item=>item.checkedAt).sort()[0] : null };
}
