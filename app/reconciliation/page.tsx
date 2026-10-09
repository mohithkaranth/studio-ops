import ReconciliationRows from "./ReconciliationRows";
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
    <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-10 sm:px-8 lg:px-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Reconciliation</h1>
        <p className="text-sm text-zinc-400">Compare September Acuity bookings with Stripe payments, then review PayNow candidates for bookings without a Stripe payment.</p>
        <p className="text-sm text-zinc-300">Stripe connection: <span className={connected ? "font-semibold text-emerald-400" : "font-semibold text-red-400"}>{connected ? "Yes" : "No"}</span></p>
      </header>
      <form action="/reconciliation" method="get" className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
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
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {(["Settled full", "Settled partial", "No settlement", "Review PayNow", "Unable to check"] as const).map(status =>
            <div key={status} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="text-sm text-zinc-400">{status}</p><p className="mt-2 text-2xl font-semibold text-zinc-50">{rows.filter(row => (row.bankMatch.bankStatus === "Review" ? "Review PayNow" : row.status) === status).length}</p></div>
          )}
        </section>
        <p className="text-sm text-zinc-400">{rows.length} bookings in September 2026, based on session date in Singapore. Stripe amounts are captured payments less refunds, before fees. Payment dates may fall outside September. PayNow candidates are checked only for bookings with no matched Stripe payment. A payer-name match is not proof of settlement; candidates require review. Only an unambiguous booking reference counts as confirmed PayNow payment. Click a booking row to view its complete Acuity record.</p>
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60"><div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-zinc-950 text-left text-xs uppercase text-zinc-400"><tr>
              {["Booking", "Session / Room", "Type", "Acuity cost", "Stripe paid", "Confirmed PayNow", "Status", "Stripe payment / Date", "PayNow evidence"].map(title => <th key={title} className="whitespace-nowrap px-4 py-3">{title}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              <ReconciliationRows rows={rows} />
            </tbody>
          </table>
        </div></section>
      </> : !run ? <p className="text-sm text-zinc-400">Select Reconcile to check September bookings against Stripe, then look for PayNow candidates in your uploaded bank statements.</p> : null}
    </main>
  );
}
