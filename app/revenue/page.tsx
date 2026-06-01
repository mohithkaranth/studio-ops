import Link from "next/link";
import RevenueReportsCharts, { type RevenueReportPoint } from "@/app/components/RevenueReportsCharts";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type RevenueReportRow = {
  month_start: Date | string;
  month_label: string;
  revenue: string | number | null;
  expenses: string | number | null;
  net_movement: string | number | null;
  transaction_count: string | number;
};

const sgdFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
});

function toNumber(value: string | number | null) {
  if (value === null) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/70 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
      <p className="text-xs uppercase tracking-wide text-zinc-400">{title}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-50">{value}</p>
    </div>
  );
}

export default async function RevenuePage() {
  const rows = await sql<RevenueReportRow[]>`
    SELECT
      date_trunc('month', transaction_date)::date AS month_start,
      TO_CHAR(date_trunc('month', transaction_date), 'Mon YYYY') AS month_label,
      SUM(COALESCE(credit, 0)) AS revenue,
      SUM(COALESCE(debit, 0)) AS expenses,
      SUM(COALESCE(credit, 0)) - SUM(COALESCE(debit, 0)) AS net_movement,
      COUNT(*) AS transaction_count
    FROM bank_transactions
    GROUP BY date_trunc('month', transaction_date)
    ORDER BY month_start ASC;
  `;

  const chartData: RevenueReportPoint[] = rows.map((row) => ({
    month_label: row.month_label,
    revenue: toNumber(row.revenue),
    expenses: toNumber(row.expenses),
  }));

  const totals = rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + toNumber(row.revenue),
      expenses: acc.expenses + toNumber(row.expenses),
      netMovement: acc.netMovement + toNumber(row.net_movement),
      transactionCount: acc.transactionCount + toNumber(row.transaction_count),
    }),
    { revenue: 0, expenses: 0, netMovement: 0, transactionCount: 0 },
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-12 sm:px-10 lg:px-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Revenue Reports</h1>
        <p className="text-sm text-zinc-400">
          Monthly revenue, expenses, and net cash movement from uploaded bank transactions.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard title="Total revenue" value={sgdFormatter.format(totals.revenue)} />
        <SummaryCard title="Total expenses" value={sgdFormatter.format(totals.expenses)} />
        <SummaryCard title="Net cash movement" value={sgdFormatter.format(totals.netMovement)} />
        <SummaryCard title="Number of transactions" value={totals.transactionCount.toLocaleString("en-SG")} />
      </section>

      {chartData.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/50 px-6 py-10 text-center">
          <h2 className="text-lg font-medium text-zinc-100">No bank transactions found</h2>
          <p className="mt-2 text-sm text-zinc-400">
            Upload bank statements to generate monthly revenue and expense reports.
          </p>
          <Link
            href="/bank-statements"
            className="mt-5 inline-block rounded-md bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white"
          >
            Upload Bank Statements
          </Link>
        </section>
      ) : (
        <RevenueReportsCharts data={chartData} />
      )}

      <Link href="/" className="inline-block text-sm text-zinc-300 hover:text-zinc-100">
        ← Back to Dashboard
      </Link>
    </div>
  );
}
