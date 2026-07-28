import { sql } from "@/lib/db";
import CustomerAnalyticsControls, { type CustomerAnalyticsExportRow } from "./CustomerAnalyticsControls";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;
type AnalyticsRow = {
  client_id: number | null;
  client: string | null;
  email: string | null;
  phone: string | null;
  first_booking: string | null;
  last_booking: string | null;
  total_bookings: number | null;
  average_bookings_per_month: string | number | null;
  months_inactive: number | null;
  customers_analysed: number;
  regular_customers: number;
  lost_customers: number;
};

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
    rows = await sql<AnalyticsRow[]>`
      WITH settings AS (
        SELECT
          ${`${fromMonth}-01`}::date AS period_start,
          (${`${toMonth}-01`}::date + INTERVAL '1 month') AS period_end,
          (${inactiveMonths} * INTERVAL '1 month') AS inactive_interval,
          ${averageBookings}::numeric AS minimum_average,
          ${minimumLifetimeBookings}::integer AS minimum_lifetime
      ), customer_activity AS (
        SELECT
          c.id AS client_id,
          COALESCE(NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''), c.email, 'Unknown client') AS client,
          c.email,
          c.phone,
          MIN((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date) AS first_booking,
          MAX((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date) AS last_booking,
          COUNT(a.id)::integer AS total_bookings,
          COUNT(a.id) FILTER (
            WHERE a.appointment_datetime >= (s.period_start::timestamp AT TIME ZONE 'Asia/Singapore')
              AND a.appointment_datetime < (s.period_end::timestamp AT TIME ZONE 'Asia/Singapore')
          )::integer AS period_bookings,
          COUNT(a.id) FILTER (
            WHERE a.appointment_datetime >= (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') - s.inactive_interval) AT TIME ZONE 'Asia/Singapore')
              AND a.appointment_datetime < ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')
          )::integer AS inactive_period_bookings,
          (EXTRACT(YEAR FROM AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date, MAX((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date))) * 12
            + EXTRACT(MONTH FROM AGE((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Singapore')::date, MAX((a.appointment_datetime AT TIME ZONE 'Asia/Singapore')::date))))::integer AS months_inactive,
          ((EXTRACT(YEAR FROM AGE(s.period_end, s.period_start)) * 12) + EXTRACT(MONTH FROM AGE(s.period_end, s.period_start)))::integer AS period_months,
          s.minimum_average,
          s.minimum_lifetime
        FROM acuity_clients c
        CROSS JOIN settings s
        LEFT JOIN acuity_appointments a ON a.client_id = c.id
          AND a.appointment_datetime IS NOT NULL
          AND COALESCE(a.canceled, false) IS FALSE
        GROUP BY c.id, c.first_name, c.last_name, c.email, c.phone, s.period_start, s.period_end, s.inactive_interval, s.minimum_average, s.minimum_lifetime
      ), classified AS (
        SELECT *, period_bookings::numeric / period_months AS average_bookings_per_month,
          (period_bookings::numeric / period_months >= minimum_average AND total_bookings >= minimum_lifetime) AS is_regular
        FROM customer_activity
      ), summary AS (
        SELECT COUNT(*)::integer AS customers_analysed,
          COUNT(*) FILTER (WHERE is_regular)::integer AS regular_customers,
          COUNT(*) FILTER (WHERE is_regular AND inactive_period_bookings = 0)::integer AS lost_customers
        FROM classified
      )
      SELECT c.client_id, c.client, c.email, c.phone,
        TO_CHAR(c.first_booking, 'YYYY-MM-DD') AS first_booking,
        TO_CHAR(c.last_booking, 'YYYY-MM-DD') AS last_booking,
        c.total_bookings, c.average_bookings_per_month, COALESCE(c.months_inactive, 0)::integer AS months_inactive,
        s.customers_analysed, s.regular_customers, s.lost_customers
      FROM summary s
      LEFT JOIN classified c ON c.is_regular AND c.inactive_period_bookings = 0
      ORDER BY c.months_inactive DESC NULLS LAST, c.client ASC;
    `;
  }

  const summary = rows[0] ?? { customers_analysed: 0, regular_customers: 0, lost_customers: 0 };
  rows = rows.filter((row) => row.client_id !== null);
  const exportRows: CustomerAnalyticsExportRow[] = rows.map((row) => ({ client: row.client ?? "Unknown client", email: row.email ?? "", phone: row.phone ?? "", firstBooking: formatDate(row.first_booking), lastBooking: formatDate(row.last_booking), totalBookings: Number(row.total_bookings), averageBookingsPerMonth: Number(row.average_bookings_per_month), monthsInactive: Number(row.months_inactive) }));

  return (
    <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
        <header className="space-y-2"><h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Customer Analytics</h1><p className="text-sm text-zinc-400">Identify regular customers who have stopped booking and may be worth contacting.</p></header>
        <section className="space-y-3 text-sm leading-6 text-zinc-300">
          <p>This report helps identify customers who were once regular visitors but have stopped booking appointments.</p>
          <p>Choose an analysis period to determine what qualifies as a regular customer, then specify how long a customer must be inactive before they are considered lost. The results can be reviewed on screen and exported to Excel for follow-up.</p>
          <p className="rounded-md border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-zinc-400"><span className="font-medium text-zinc-200">Note:</span> The selected analysis period must end at least 3 months before the current month, ensuring there is enough time to identify customers who have become inactive.</p>
        </section>
        <CustomerAnalyticsControls {...{ fromMonth, toMonth, averageBookings, inactiveMonths, minimumLifetimeBookings, maximumToMonth, validationMessage, results: exportRows }} />
        <section className="grid gap-4 sm:grid-cols-3"><SummaryCard title="Customers Analysed" value={Number(summary.customers_analysed)} /><SummaryCard title="Regular Customers" value={Number(summary.regular_customers)} /><SummaryCard title="Lost Customers" value={Number(summary.lost_customers)} /></section>
        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="border-b border-zinc-800 px-4 py-3"><h2 className="text-lg font-medium text-zinc-100">Lost customers</h2></div>
          <div className="overflow-x-auto"><table className="min-w-full divide-y divide-zinc-800 text-sm"><thead className="bg-zinc-950/70 text-left text-xs uppercase tracking-wide text-zinc-500"><tr>{["Client", "Email", "Phone", "First Booking", "Last Booking", "Total Bookings", "Average Bookings / Month", "Months Inactive", "Status"].map((header) => <th key={header} className="whitespace-nowrap px-4 py-3 font-medium">{header}</th>)}</tr></thead>
            <tbody className="divide-y divide-zinc-800 text-zinc-300">{rows.length === 0 ? <tr><td colSpan={9} className="px-4 py-8 text-center text-zinc-500">{analysed && !validationMessage ? "No lost customers match the selected filters." : "Choose your filters and select Analyse to view results."}</td></tr> : rows.map((row) => <tr key={row.client_id}><td className="px-4 py-3 text-zinc-100">{row.client}</td><td className="px-4 py-3">{row.email ?? "—"}</td><td className="whitespace-nowrap px-4 py-3">{row.phone ?? "—"}</td><td className="whitespace-nowrap px-4 py-3">{formatDate(row.first_booking)}</td><td className="whitespace-nowrap px-4 py-3">{formatDate(row.last_booking)}</td><td className="px-4 py-3">{Number(row.total_bookings).toLocaleString("en-SG")}</td><td className="px-4 py-3">{displayAverage(Number(row.average_bookings_per_month))}</td><td className="px-4 py-3">{row.months_inactive}</td><td className="px-4 py-3"><span className="rounded-full border border-red-900/80 bg-red-950/50 px-2 py-1 text-xs font-medium text-red-300">Lost</span></td></tr>)}</tbody>
          </table></div>
        </section>
      </div>
    </main>
  );
}
