import "server-only";
import { sql } from "@/lib/db";
import { sgdCents } from "@/lib/stripe/reconciliation-model";
import { assertAllocation, type Allocation } from "@/lib/bank-allocation-model";

// Statement uploads replace transaction IDs. This source identity survives the same
// transaction being uploaded again or appearing in an overlapping statement period.
export const bankTransactionKey = sql`md5(jsonb_build_array(
  u.account_number, upper(u.currency), t.transaction_date::date::text,
  t.value_date::date::text, t.description_1, t.description_2,
  round(t.credit * 100)::bigint, round(t.running_balance * 100)::bigint
)::text)`;

let setup: Promise<void> | undefined;
export async function ensureBankAllocationTables() {
  if (!setup) setup = sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(681724903)`;
    await tx`create table if not exists bank_payment_allocations (
      id bigserial primary key,
      transaction_key text not null,
      bank_transaction_id text not null,
      appointment_id text not null,
      allocated_cents bigint not null check (allocated_cents > 0),
      credit_cents bigint not null check (credit_cents > 0 and allocated_cents <= credit_cents),
      confirmation_method text not null check (confirmation_method in ('booking_reference', 'manual')),
      confirmed_at timestamptz not null default now(),
      released_at timestamptz,
      evidence jsonb not null,
      unique (transaction_key, appointment_id)
    )`;
    await tx`create index if not exists bank_payment_allocations_booking on bank_payment_allocations (appointment_id) where released_at is null`;
    await tx`create table if not exists bank_paynow_matches (
      year integer not null, month integer not null,
      transaction_key text not null, appointment_id text not null,
      primary key (year, month, transaction_key, appointment_id)
    )`;
    await tx`create table if not exists bank_reconciliation_history (
      year integer not null, month integer not null check (month between 1 and 12),
      status text not null check (status in ('running', 'complete', 'partial', 'failed')),
      source_fingerprint text not null,
      bookings integer not null default 0, issues integer not null default 0,
      confirmed_credits integer not null default 0, confirmed_cents bigint not null default 0,
      started_at timestamptz not null default now(), finished_at timestamptz,
      message text,
      primary key (year, month)
    )`;
  }).then(() => {}).catch(error => { setup = undefined; throw error; });
  await setup;
}

// Matched payments are accounted for as a whole, including shared candidates.
// Keep this separate from amount allocations: matching must not allocate the
// same credit repeatedly when it appears against more than one booking.
export async function savePayNowMatches(year: number, month: number, matches: {
  transactionKey: string; appointmentId: string;
}[]) {
  await ensureBankAllocationTables();
  await sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(${year * 12 + month})`;
    await tx`delete from bank_paynow_matches where year = ${year} and month = ${month}`;
    for (const match of matches) await tx`insert into bank_paynow_matches
      (year, month, transaction_key, appointment_id)
      values (${year}, ${month}, ${match.transactionKey}, ${match.appointmentId})
      on conflict do nothing`;
  });
}

export type SavedBankAllocation = {
  transactionKey: string; transactionId: string; appointmentId: string;
  cents: number; creditCents: number; date: string; description: string;
  description2: string | null; method: "booking_reference" | "manual";
};

export async function readBankAllocations(): Promise<SavedBankAllocation[]> {
  await ensureBankAllocationTables();
  const rows = await sql<(Omit<SavedBankAllocation, "cents" | "creditCents"> & { cents: string; creditCents: string })[]>`
    select distinct on (a.transaction_key, a.appointment_id)
      a.transaction_key as "transactionKey", t.id::text as "transactionId",
      a.appointment_id as "appointmentId", a.allocated_cents::text as cents,
      a.credit_cents::text as "creditCents", t.transaction_date::date::text as date,
      concat_ws(' ', t.description_1, t.description_2) as description,
      t.description_2 as "description2", a.confirmation_method as method
    from bank_payment_allocations a
    join bank_transactions t on t.credit > 0
    join bank_statement_uploads u on u.id = t.upload_id
    where a.released_at is null and a.transaction_key = ${bankTransactionKey}
    order by a.transaction_key, a.appointment_id, t.id
  `;
  return rows.map(row => ({ ...row, cents: Number(row.cents), creditCents: Number(row.creditCents) }));
}

export async function saveBankAllocation({ transactionId, appointmentId, cents, method }: {
  transactionId: string; appointmentId: string; cents: number; method: "booking_reference" | "manual";
}) {
  await ensureBankAllocationTables();
  return sql.begin(async tx => {
    const credits = await tx<{ key: string; credit: string; evidence: { date: string; description1: string | null; description2: string | null; account: string | null }; other_reference: boolean }[]>`
      select ${bankTransactionKey} as key, t.credit::text,
        jsonb_build_object('date', t.transaction_date, 'description1', t.description_1,
          'description2', t.description_2, 'account', u.account_number) as evidence,
        exists (select 1 from acuity_appointments a where a.acuity_appointment_id::text <> ${appointmentId}
          and a.acuity_appointment_id::text ~ '^[0-9]+$' and concat_ws(' ', t.description_1, t.description_2)
            ~ ('(^|[^0-9])' || a.acuity_appointment_id::text || '([^0-9]|$)')) as other_reference
      from bank_transactions t join bank_statement_uploads u on u.id = t.upload_id
      where t.id::text = ${transactionId} and t.credit > 0 and coalesce(t.debit, 0) = 0
        and upper(u.currency) = 'SGD'
        and (t.description_1 ilike '%paynow%' or t.description_2 ilike '%paynow%')
      for share of t, u
    `;
    const credit = credits[0];
    if (!credit) throw new Error("This SGD PayNow credit is no longer available. Refresh the statement.");
    await tx`select pg_advisory_xact_lock(hashtext(${credit.key}))`;
    const booking = await tx`select acuity_appointment_id from acuity_appointments where acuity_appointment_id::text = ${appointmentId} for share`;
    if (!booking.length) throw new Error("Booking not found.");
    if (method === "booking_reference" && credit.other_reference) return false;
    const existing = await tx<{ appointmentId: string; cents: string; method: string; released_at: Date | null }[]>`
      select appointment_id as "appointmentId", allocated_cents::text as cents,
        confirmation_method as method, released_at from bank_payment_allocations
      where transaction_key = ${credit.key} for update
    `;
    // A released or manually edited confirmation is never silently recreated by an automatic rerun.
    if (method === "booking_reference" && existing.some(item => item.appointmentId === appointmentId)) return false;
    const creditCents = sgdCents(credit.credit);
    if (creditCents === null) throw new Error("Invalid credit amount.");
    const allocations: Allocation[] = existing.filter(item => item.released_at === null)
      .map(item => ({ transactionKey: credit.key, appointmentId: item.appointmentId, cents: Number(item.cents) }));
    assertAllocation(creditCents, allocations, appointmentId, cents);
    await tx`insert into bank_payment_allocations
      (transaction_key, bank_transaction_id, appointment_id, allocated_cents, credit_cents, confirmation_method, evidence)
      values (${credit.key}, ${transactionId}, ${appointmentId}, ${cents}, ${creditCents}, ${method}, ${tx.json(credit.evidence)})
      on conflict (transaction_key, appointment_id) do update set allocated_cents = excluded.allocated_cents,
        credit_cents = excluded.credit_cents, confirmation_method = excluded.confirmation_method,
        bank_transaction_id = excluded.bank_transaction_id, evidence = excluded.evidence,
        confirmed_at = now(), released_at = null`;
    return true;
  });
}

export async function releaseBankAllocation(transactionId: string, appointmentId: string) {
  await ensureBankAllocationTables();
  await sql.begin(async tx => {
    const credits = await tx<{ key: string }[]>`select ${bankTransactionKey} as key
      from bank_transactions t join bank_statement_uploads u on u.id = t.upload_id where t.id::text = ${transactionId}`;
    if (!credits[0]) throw new Error("Bank transaction not found.");
    await tx`select pg_advisory_xact_lock(hashtext(${credits[0].key}))`;
    await tx`update bank_payment_allocations set released_at = now()
      where transaction_key = ${credits[0].key} and appointment_id = ${appointmentId} and released_at is null`;
  });
}
