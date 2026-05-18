import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
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
    limit 1
  `;

  const latest = uploads[0] ?? null;

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
        }[]
      >`
      select transaction_date::text, value_date::text, description_1, description_2, debit::text, credit::text, running_balance::text
      from bank_transactions
      where upload_id = ${latest.id}
      order by transaction_date asc, id asc
    `
    : [];

  return Response.json({ latest, transactions });
}
