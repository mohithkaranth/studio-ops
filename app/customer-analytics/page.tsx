import {requireStudioSession} from '@/lib/studio-auth-request';
import {getCustomerAnalytics, type AnalyticsRow} from "@/lib/customer-analytics";
import CustomerAnalyticsControls, { type CustomerAnalyticsExportRow } from "./CustomerAnalyticsControls";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function singaporeMonth(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function positiveNumber(value: string | string[] | undefined, fallback: number, allowed?: number[]) {
  const parsed = Number(firstValue(value));
  return Number.isFinite(parsed) && parsed >= 1 && (!allowed || allowed.includes(parsed)) ? parsed : fallback;
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${value}T00:00:00+08:00`));
}

function displayAverage(value: number) {
  return value.toLocaleString("en-SG", { maximumFractionDigits: 2 });
}

function SummaryCard({ title, value }: { title: string; value: number }) {
  return <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</p><p className="mt-2 text-2xl font-semibold text-zinc-50">{value.toLocaleString("en-SG")}</p></div>;
}

export default async function CustomerAnalyticsPage({ searchParams }: { searchParams: SearchParams }) {
  await requireStudioSession();

  const params = await searchParams;
  const maximumToMonth = singaporeMonth(-4);
  const rawFromMonth = firstValue(params.fromMonth);
  const rawToMonth = firstValue(params.toMonth);
  const fromMonth = rawFromMonth ?? singaporeMonth(-15);
  const toMonth = rawToMonth ?? maximumToMonth;
  const averageBookings = positiveNumber(params.averageBookings, 2);
  const inactiveMonths = positiveNumber(params.inactiveMonths, 3, [3, 6, 9, 12]);
  const minimumLifetimeBookings = Math.floor(positiveNumber(params.minimumLifetimeBookings, 10));
  const analysed = firstValue(params.analysed) === "1";

  let validationMessage: string | null = null;
  if (analysed && (!rawFromMonth || !rawToMonth)) validationMessage = "From Month and To Month are required.";
  else if (!monthPattern.test(fromMonth) || !monthPattern.test(toMonth)) validationMessage = "Enter a valid analysis period.";
  else if (fromMonth > toMonth) validationMessage = "From Month must not be after To Month.";
  else if (toMonth > maximumToMonth) validationMessage = "To Month must end at least 3 complete calendar months before the current month.";

  let rows: AnalyticsRow[] = [];
  if (analysed && !validationMessage) {
    rows = await getCustomerAnalytics({fromMonth,toMonth,averageBookings,inactiveMonths,minimumLifetimeBookings});
  }

  const summary = rows[0] ?? { customers_analysed: 0, regular_customers: 0, lost_customers: 0 };
  rows = rows.filter((row) => row.client !== null);
  const exportRows: CustomerAnalyticsExportRow[] = rows.map((row) => ({ client: row.client ?? "Unknown client", email: row.email ?? "", phone: row.phone ?? "", firstBooking: formatDate(row.first_booking), lastBooking: formatDate(row.last_booking), totalBookings: Number(row.total_bookings), averageBookingsPerMonth: Number(row.average_bookings_per_month), monthsInactive: Number(row.months_inactive) }));

  return (
    <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
        <header className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Customer Analytics</h1><p className="text-sm text-zinc-400">Identify regular customers who have stopped booking and may be worth contacting.</p></header>
        <section className="space-y-3 text-sm leading-6 text-zinc-300">
          <p>This report helps identify customers who were once regular visitors but have stopped booking appointments.</p>
          <p>Choose an analysis period to determine what qualifies as a regular customer, then specify how long a customer must be inactive before they are considered lost. The results can be reviewed on screen and exported to Excel for follow-up.</p>
          <p>Bookings are grouped by email address, or by phone number when email is missing. Bookings with neither are kept separate.</p>
          <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-zinc-400"><span className="font-medium text-zinc-200">Note:</span> The selected analysis period must end at least 3 months before the current month, ensuring there is enough time to identify customers who have become inactive.</p>
        </section>
        <CustomerAnalyticsControls {...{ fromMonth, toMonth, averageBookings, inactiveMonths, minimumLifetimeBookings, maximumToMonth, validationMessage, results: exportRows }} />
        <section className="grid gap-4 sm:grid-cols-3"><SummaryCard title="Customers Analysed" value={Number(summary.customers_analysed)} /><SummaryCard title="Regular Customers" value={Number(summary.regular_customers)} /><SummaryCard title="Lost Customers" value={Number(summary.lost_customers)} /></section>
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="border-b border-zinc-800 px-4 py-3"><h2 className="text-lg font-medium text-zinc-100">Lost customers</h2></div>
          <div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-800 text-sm"><thead className="bg-zinc-950/70 text-left text-xs uppercase tracking-wide text-zinc-500"><tr>{["Client", "Email", "Phone", "First Booking", "Last Booking", "Total Bookings", "Average Bookings / Month", "Months Inactive", "Status"].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 font-medium">{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">{rows.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">{analysed && !validationMessage ? "No lost customers match the selected filters." : "Choose your filters and select Analyse to view results."}</td></tr> : rows.map((row) => <tr key={row.customer_key}><td className="px-4 py-3 text-zinc-100">{row.client}</td><td className="px-4 py-3">{row.email ?? "—"}</td><td className="whitespace-nowrap px-4 py-3">{row.phone ?? "—"}</td><td className="whitespace-nowrap px-4 py-3">{formatDate(row.first_booking)}</td><td className="whitespace-nowrap px-4 py-3">{formatDate(row.last_booking)}</td><td className="px-4 py-3">{Number(row.total_bookings).toLocaleString("en-SG")}</td><td className="px-4 py-3">{displayAverage(Number(row.average_bookings_per_month))}</td><td className="px-4 py-3">{row.months_inactive}</td><td className="px-4 py-3"><span className="rounded-full border border-red-900/80 bg-red-950/50 px-2 py-1 text-xs font-medium text-red-300">Lost</span></td></tr>)}</tbody>
          </table></div>
        </section>
      </div>
    </main>
  );
}
