import type { ReconciliationRow } from "@/lib/stripe/reconciliation";
import ReconciliationRows from "./ReconciliationRows";

export default function ReconciliationTable({ rows, title = "Booking details", emptyMessage }: {
  rows: ReconciliationRow[];
  title?: string;
  emptyMessage?: string;
}) {
  return <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
      <h2 className="text-lg font-medium text-zinc-100">{title}</h2>
      <p className="text-xs text-zinc-500">{rows.length.toLocaleString("en-SG")} bookings</p>
    </div>
    <div className="max-h-[65vh] overflow-auto" tabIndex={0} role="region" aria-label={title + " — scroll horizontally and vertically"}>
      <table className="min-w-full divide-y divide-zinc-800 text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-950 text-left text-xs uppercase tracking-wide text-zinc-500">
          <tr>{["Booking", "Booked on", "Session / Room", "Type", "Acuity cost", "Stripe paid", "Confirmed PayNow", "Status", "PayNow evidence"].map(title =>
            <th key={title} className="whitespace-nowrap px-4 py-3 font-medium">{title}</th>
          )}</tr>
        </thead>
        <tbody className="divide-y divide-zinc-800 text-zinc-300"><ReconciliationRows rows={rows} emptyMessage={emptyMessage} /></tbody>
      </table>
    </div>
  </section>;
}
