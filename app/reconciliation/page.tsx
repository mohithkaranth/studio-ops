import { checkStripeConnection } from "@/lib/stripe/connection";
import { reconcileStripeBookings, type ReconciliationRow } from "@/lib/stripe/reconciliation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const date = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const amount = (cents: number | null) => cents === null ? "—" : money.format(cents / 100);

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
        <p className="text-sm text-zinc-400">Compare Acuity booking costs with Stripe payments. Testing is limited to September 2026.</p>
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
        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {(["Settled full", "Settled partial", "No settlement", "Unable to check"] as const).map(status =>
            <div key={status} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="text-sm text-zinc-400">{status}</p><p className="mt-2 text-2xl font-semibold text-zinc-50">{rows.filter(row => row.status === status).length}</p></div>
          )}
        </section>
        <p className="text-sm text-zinc-400">{rows.length} bookings in September 2026, based on session date in Singapore. Stripe amounts are captured payments less refunds, before fees. Payment dates may fall outside September. PayNow is not included yet.</p>
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60"><div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm">
            <thead className="bg-zinc-950 text-left text-xs uppercase text-zinc-400"><tr>
              {["Booking", "Session / Room", "Acuity cost", "Stripe paid", "Difference", "Status", "Stripe payment / Date"].map(title => <th key={title} className="whitespace-nowrap px-4 py-3">{title}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">
              {rows.length === 0 ? <tr><td colSpan={7} className="px-4 py-8 text-center">No Acuity bookings found for September 2026.</td></tr> : rows.map(row => <tr key={row.appointmentId}>
                <td className="px-4 py-3"><p className="font-medium text-zinc-100">{row.client}</p><p className="text-xs text-zinc-500">#{row.appointmentId}</p>{row.email ? <p className="text-xs text-zinc-400">{row.email}</p> : null}</td>
                <td className="whitespace-nowrap px-4 py-3">{date.format(new Date(row.appointmentDate))}<p className="text-xs text-zinc-500">{row.room ?? "—"}</p></td>
                <td className="whitespace-nowrap px-4 py-3">{amount(row.costCents)}</td>
                <td className="whitespace-nowrap px-4 py-3">{amount(row.stripeCents)}</td>
                <td className="whitespace-nowrap px-4 py-3">{amount(row.costCents === null || row.stripeCents === null ? null : row.costCents - row.stripeCents)}</td>
                <td className="px-4 py-3"><span className={row.status === "Settled full" ? "text-emerald-400" : row.status === "Settled partial" ? "text-amber-400" : row.status === "No settlement" ? "text-red-400" : "text-zinc-300"}>{row.status}</span>{row.note ? <p className="mt-1 max-w-xs text-xs text-zinc-400">{row.note}</p> : null}</td>
                <td className="px-4 py-3">{row.paymentIds.length ? row.paymentIds.map((id, index) => <p key={id} className="whitespace-nowrap text-xs">{id}<br />{date.format(new Date(row.paymentDates[index]))}</p>) : "—"}</td>
              </tr>)}
            </tbody>
          </table>
        </div></section>
      </> : !run ? <p className="text-sm text-zinc-400">Select Reconcile to check September bookings. Payments are matched using the Stripe transaction references attached to each Acuity booking.</p> : null}
    </main>
  );
}
