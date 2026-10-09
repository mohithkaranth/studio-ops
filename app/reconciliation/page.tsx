import Link from "next/link";
import ReconciliationTable from "./ReconciliationTable";
import ReconciliationFilters from "./ReconciliationFilters";
import { getReconciliationPeriods, getBankStatementCoverage } from "@/lib/reconciliation-period-data";
import { availablePeriod, defaultPeriod, periodLabel } from "@/lib/reconciliation-period";
import { reconciliationStatuses, displayReconciliationStatus } from "@/lib/reconciliation-status";
import { checkStripeConnection } from "@/lib/stripe/connection";
import { reconcileStripeBookings, type ReconciliationRow } from "@/lib/stripe/reconciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const [periods, bankCoverage] = await Promise.all([getReconciliationPeriods(), getBankStatementCoverage()]);
  const fallback = defaultPeriod(periods);
  const month = Number(first(params.month) ?? fallback?.month ?? 1);
  const year = Number(first(params.year) ?? fallback?.year ?? 2026);
  const validPeriod = availablePeriod(periods, year, month);
  const selectedMonth = validPeriod ? month : fallback?.month ?? 1;
  const selectedYear = validPeriod ? year : fallback?.year ?? 2026;
  const selectedLabel = periodLabel(selectedYear, selectedMonth);
  const run = first(params.run) === "1";
  const connected = await checkStripeConnection();
  let rows: ReconciliationRow[] = [];
  let error: string | null = null;
  if (run && !validPeriod) error = "Choose an available booking period from January 2026 onward.";
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
        <p className="text-sm text-zinc-400">Compare Acuity bookings with Stripe payments, then review PayNow candidates for bookings without a Stripe payment. Available periods start from January 2026.</p>
        <p className="text-sm text-zinc-300">Stripe connection: <span className={connected ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{connected ? "Yes" : "No"}</span></p>
      </header>
      {fallback ? <ReconciliationFilters key={`${selectedYear}-${selectedMonth}`} periods={periods} initialYear={selectedYear} initialMonth={selectedMonth} /> : <p className="text-sm text-zinc-400">No Acuity bookings are available from January 2026 onward.</p>}
      <p className="text-xs text-zinc-500">{bankCoverage.from && bankCoverage.to ? `Uploaded bank statements: ${bankCoverage.from} to ${bankCoverage.to}.` : "No SGD bank statements have been uploaded."}</p>
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
        <p className="text-sm text-zinc-400">{rows.length} bookings in {selectedLabel}, based on session date in Singapore. Stripe amounts are captured payments less refunds, before fees. Payment dates may fall outside the selected month. PayNow candidates are checked only for bookings with no matched Stripe payment. The bank search covers the booking date through 7 days after the session. If the booking date is missing, it uses 7 days around the session. Payer names and names in booking emails help find candidates. Different amounts are considered only within 7 days of booking or session; all name-based candidates require review. Only an unambiguous booking reference counts as confirmed PayNow payment. Click a booking row to view its complete Acuity record.</p>
        <ReconciliationTable rows={rows} emptyMessage={`No bookings found for ${selectedLabel}.`} />
      </> : !run ? <p className="text-sm text-zinc-400">Choose a month and year, then select Reconcile to check bookings against Stripe and your uploaded PayNow bank statements.</p> : null}
      <Link href="/" className="inline-block text-sm text-zinc-400 hover:text-zinc-100">← Back to Dashboard</Link>
      </div>
    </main>
  );
}
