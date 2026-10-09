import BackToPrevious from "@/app/components/BackToPrevious";
import { notFound } from "next/navigation";
import ReconciliationTable from "../../ReconciliationTable";
import { reconciliationStatuses, displayReconciliationStatus } from "@/lib/reconciliation-status";
import { reconcileStripeBookings, type ReconciliationRow } from "@/lib/stripe/reconciliation";

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
  const month = Number(first(query.month) ?? 9);
  const year = Number(first(query.year) ?? 2026);
  let rows: ReconciliationRow[] = [];
  let error: string | null = null;
  if (month !== 9 || year !== 2026) error = "Testing is currently limited to September 2026.";
  else {
    try {
      const allRows = await reconcileStripeBookings(year, month);
      rows = allRows.filter(row => displayReconciliationStatus(row) === selected.label);
    } catch (issue) {
      error = issue instanceof Error ? issue.message : "Reconciliation could not be completed. Try again.";
    }
  }

  return <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">{selected.label}</h1>
        <p className="text-sm text-zinc-400">September 2026 reconciliation · Click a booking to view its Acuity details.</p>
      </header>
      <BackToPrevious fallbackHref="/reconciliation?month=9&year=2026&run=1" />
      {error ? <p role="alert" className="rounded-xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">{error}</p> : <>
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Bookings</p>
            <p className="mt-2 text-2xl font-semibold text-zinc-50">{rows.length.toLocaleString("en-SG")}</p>
          </div>
        </section>
        <ReconciliationTable rows={rows} title={selected.label + " bookings"} emptyMessage="No bookings in this status for September 2026." />
      </>}
    </div>
  </main>;
}
