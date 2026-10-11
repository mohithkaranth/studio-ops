import { sql } from "@/lib/db";
import { ensureBankAllocationTables, bankTransactionKey } from "@/lib/bank-allocations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await ensureBankAllocationTables();
  const uploads = await sql<
    {
      id: number;
      statement_start_date: string;
      statement_end_date: string;
      account_number: string | null;
      transaction_count: number;
      total_debit: string | null;
      total_credit: string | null;
      net_amount: string | null;
    }[]
  >`
    select u.id, u.statement_start_date::text, u.statement_end_date::text, u.account_number,
      count(t.id)::int as transaction_count,
      coalesce(sum(t.debit), 0)::text as total_debit,
      coalesce(sum(t.credit), 0)::text as total_credit,
      coalesce(sum(t.credit - t.debit), 0)::text as net_amount
    from bank_statement_uploads u
    left join bank_transactions t on t.upload_id = u.id
    group by u.id
    order by u.uploaded_at desc nulls last, u.id desc
  `;

  const uploadId = new URL(request.url).searchParams.get('uploadId');
  const latest = uploadId ? uploads.find(upload => String(upload.id) === uploadId) ?? null : uploads[0] ?? null;
  if (uploadId && !latest) return Response.json({ error: 'Statement not found. Refresh the list.' }, { status: 404 });

  const transactions = latest
    ? await sql<
        {
          transaction_date: string;
          value_date: string | null;
          description_1: string | null;
          description_2: string | null;
          debit: string | null;
          credit: string | null;
          running_balance: string | null;
          id: string;
          allocated_cents: number;
          remaining_cents: number;
          allocations: { appointmentId: string; cents: number; method: string }[];
        }[]
      >`
      select t.id::text, t.transaction_date::text, t.value_date::text, t.description_1, t.description_2,
        t.debit::text, t.credit::text, t.running_balance::text,
        coalesce(saved.cents, 0)::float8 as allocated_cents,
        greatest(0, round(coalesce(t.credit, 0) * 100) - coalesce(saved.cents, 0))::float8 as remaining_cents,
        coalesce(saved.allocations, '[]'::jsonb) as allocations
      from bank_transactions t join bank_statement_uploads u on u.id = t.upload_id
      left join lateral (select sum(a.allocated_cents) as cents,
        jsonb_agg(jsonb_build_object('appointmentId', a.appointment_id, 'cents', a.allocated_cents,
          'method', a.confirmation_method) order by a.appointment_id) as allocations
        from bank_payment_allocations a where a.transaction_key = ${bankTransactionKey} and a.released_at is null) saved on true
      where t.upload_id = ${latest.id}
      order by t.transaction_date asc, t.id asc
    `
    : [];

  return Response.json({ latest, transactions, uploads: uploads.map(upload => ({ id: upload.id,
    from: upload.statement_start_date, to: upload.statement_end_date })) });
}
