import BackToPrevious from "@/app/components/BackToPrevious";
import { notFound } from "next/navigation";
import ReconciliationTable from "../../ReconciliationTable";
import { getReconciliationPeriods } from "@/lib/reconciliation-period-data";
import { availablePeriod, defaultPeriod, periodLabel } from "@/lib/reconciliation-period";
import { reconciliationStatuses, displayReconciliationStatus } from "@/lib/reconciliation-status";
import { reconcileStripeBookings, type ReconciliationRow } from "@/lib/stripe/reconciliation";
import { getUnsettledTotals } from "@/lib/unsettled-totals-data";
import { getBankHistory } from "@/lib/bank-reconciliation-history";
import Link from "next/link";

const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

export default async function ReconciliationStatusPage({ params, searchParams }: {
  params: Promise<{ status: string }>;
  searchParams: SearchParams;
}) {
  const [{ status }, query] = await Promise.all([params, searchParams]);
  const selected = reconciliationStatuses.find(item => item.slug === status);
  if (!selected) notFound();
  const periods = await getReconciliationPeriods();
  const fallback = defaultPeriod(periods);
  const month = Number(first(query.month) ?? fallback?.month ?? 1);
  const year = Number(first(query.year) ?? fallback?.year ?? 2026);
  const validPeriod = availablePeriod(periods, year, month);
  const label = validPeriod ? periodLabel(year, month) : "Selected period";
  let rows: ReconciliationRow[] = [];
  let totals: Awaited<ReturnType<typeof getUnsettledTotals>> | null = null;
  let totalsError: string | null = null;
  let uncheckedMonths = 0;
  let error: string | null = null;
  if (!validPeriod) error = "Choose an available booking period from January 2026 onward.";
  else {
    try {
      const allRows = await reconcileStripeBookings(year, month);
      rows = allRows.filter(row => displayReconciliationStatus(row) === selected.label);
      if (status === "no-settlement") {
        try {
          totals = await getUnsettledTotals(rows);
          uncheckedMonths = (await getBankHistory(year, month)).months.filter(item => item.status !== "complete").length;
        }
        catch { totalsError = "Unaccounted PayNow credits could not be loaded. Refresh to try again."; }
      }
    } catch (issue) {
      error = issue instanceof Error ? issue.message : "Reconciliation could not be completed. Try again.";
    }
  }

  return <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">{selected.label}</h1>
        <p className="text-sm text-zinc-400">{label} reconciliation · Click a booking to view its Acuity details.</p>
      </header>
      <BackToPrevious fallbackHref={validPeriod ? `/reconciliation?month=${month}&year=${year}&run=1` : "/reconciliation"} />
      {error ? <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{error}</p> : <>
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Bookings</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-50">{rows.length.toLocaleString("en-SG")}</p>
          </div>
          {status === "no-settlement" ? <>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Total Acuity cost</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">{rows.some(row => row.costCents === null) ? "Unavailable" : money.format(rows.reduce((total, row) => total + (row.costCents ?? 0), 0) / 100)}</p>
              <p className="mt-2 text-xs text-zinc-400">Sum of Acuity costs in the bookings below.</p>
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Unaccounted PayNow credits</p>
              <p className="mt-2 text-2xl font-semibold text-zinc-50">{totals ? money.format(totals.payNowCents / 100) : "Unavailable"}</p>
              {totals ? <>
                <p className="mt-2 text-xs text-zinc-400">{totals.creditCount.toLocaleString("en-SG")} separate credits · each counted once</p>
                {totals.windows.length ? <p className="mt-1 text-xs text-zinc-400">Payment windows span {totals.windows.map(window => window.from).sort()[0]} to {totals.windows.map(window => window.to).sort().at(-1)}</p> : null}
              </> : null}
            </div>
          </> : null}
        </section>
        {status === "no-settlement" ? <div className="space-y-2 text-sm text-zinc-400">
          <p>PayNow total includes the unallocated balance of uploaded SGD credits between the booking and session dates, inclusive, for the bookings below. Payer names and individual payment amounts do not restrict this total. PayNow matched credits from every month are excluded, and saved allocations are deducted. This comparison does not settle individual bookings.</p>
          {uncheckedMonths ? <p role="alert" className="text-amber-300">Provisional total: {uncheckedMonths} month(s) of payment history still need checking. <Link className="underline" href={`/reconciliation?month=${month}&year=${year}`}>Check / resume PayNow history</Link>.</p> : null}
          {totals?.missingWindows ? <p role="alert" className="text-amber-300">{totals.missingWindows} booking(s) have missing or invalid booking dates. Their payment windows cannot be included in the PayNow total.</p> : null}
          {totalsError ? <p role="alert" className="text-amber-300">{totalsError}</p> : null}
        </div> : null}
        <ReconciliationTable rows={rows} title={selected.label + " bookings"} emptyMessage={`No bookings in this status for ${label}.`} />
      </>}
    </div>
  </main>;
}
