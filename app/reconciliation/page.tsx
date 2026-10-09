import Link from "next/link";
import ReconciliationTable from "./ReconciliationTable";
import { reconciliationStatuses, displayReconciliationStatus } from "@/lib/reconciliation-status";
import { checkStripeConnection } from "@/lib/stripe/connection";
import { reconcileStripeBookings, type ReconciliationRow } from "@/lib/stripe/reconciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const month = Number(first(params.month) ?? 9);
  const year = Number(first(params.year) ?? 2026);
  const selectedMonth = Number.isInteger(month) && month >= 1 && month <= 12 ? month : 9;
  const selectedYear = [2024, 2025, 2026].includes(year) ? year : 2026;
  const run = first(params.run) === "1";
  const validPeriod = month === 9 && year === 2026;
  const connected = await checkStripeConnection();
  let rows: ReconciliationRow[] = [];
  let error: string | null = null;
  if (run && !validPeriod) error = "Testing is currently limited to September 2026.";
  else if (run && !connected) error = "Stripe connection failed. Check the connection and try again.";
  else if (run) {
    try { rows = await reconcileStripeBookings(year, month); }
    catch (issue) { error = issue instanceof Error ? issue.message : "Reconciliation could not be completed. Try again."; }
  }

  return (
    <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Reconciliation</h1>
        <p className="text-sm text-zinc-400">Compare September Acuity bookings with Stripe payments, then review PayNow candidates for bookings without a Stripe payment.</p>
        <p className="text-sm text-zinc-300">Stripe connection: <span className={connected ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{connected ? "Yes" : "No"}</span></p>
      </header>
      <form action="/reconciliation" method="get" className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <label className="space-y-2 text-sm text-zinc-300"><span className="block">Month</span>
          <select name="month" defaultValue={selectedMonth} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
            {months.map((name, index) => <option key={name} value={index + 1} disabled={index !== 8}>{name}</option>)}
          </select>
        </label>
        <label className="space-y-2 text-sm text-zinc-300"><span className="block">Year</span>
          <select name="year" defaultValue={selectedYear} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
            {[2024, 2025, 2026].map(value => <option key={value} value={value} disabled={value !== 2026}>{value}</option>)}
          </select>
        </label>
        <button type="submit" name="run" value="1" className="rounded-md bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">Reconcile</button>
      </form>
      {error ? <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{error}</p> : null}
      {run && !error ? <>
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reconciliationStatuses.map(({ slug, label }) => {
            const count = rows.filter(row => displayReconciliationStatus(row) === label).length;
            return <div key={slug} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{label}</p>
              <Link href={`/reconciliation/status/${slug}?month=${selectedMonth}&year=${selectedYear}`} prefetch={false}
                aria-label={`View ${count} ${label.toLowerCase()} bookings`}
                className="mt-2 inline-block rounded text-2xl font-semibold text-zinc-50 underline decoration-zinc-600 underline-offset-4 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-300">
                {count.toLocaleString("en-SG")}
              </Link>
            </div>;
          })}
        </section>
        <p className="text-sm text-zinc-400">{rows.length} bookings in September 2026, based on session date in Singapore. Stripe amounts are captured payments less refunds, before fees. Payment dates may fall outside September. PayNow candidates are checked only for bookings with no matched Stripe payment. A payer-name match is not proof of settlement; candidates require review. Only an unambiguous booking reference counts as confirmed PayNow payment. Click a booking row to view its complete Acuity record.</p>
        <ReconciliationTable rows={rows} />
      </> : !run ? <p className="text-sm text-zinc-400">Select Reconcile to check September bookings against Stripe, then look for PayNow candidates in your uploaded bank statements.</p> : null}
      <Link href="/" className="inline-block text-sm text-zinc-400 hover:text-zinc-100">← Back to Dashboard</Link>
      </div>
    </main>
  );
}
