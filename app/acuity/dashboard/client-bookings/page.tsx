import Link from "next/link";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  client?: string;
  limit?: string;
}>;

type AppointmentRow = {
  acuity_appointment_id: string | null;
  appointment_datetime: Date | string | null;
  created_datetime: Date | string | null;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  appointment_type_name: string | null;
  calendar_name: string | null;
  price: string | number | null;
  paid_status: string | null;
  canceled: boolean | null;
};

function getLimit(value: string | undefined) {
  if (value === "all") return null;

  const parsed = Number(value ?? 30);
  if (parsed === 100) return 100;

  return 30;
}

function formatDateTime(value: Date | string | null) {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMoney(value: string | number | null) {
  const amount = typeof value === "number" ? value : Number(value ?? 0);

  return new Intl.NumberFormat("en-SG", {
    style: "currency",
    currency: "SGD",
  }).format(Number.isFinite(amount) ? amount : 0);
}

function clientName(row: AppointmentRow) {
  const name = [row.client_first_name, row.client_last_name]
    .filter(Boolean)
    .join(" ")
    .trim();

  return name || row.client_email || "Unknown client";
}

function SummaryCard({ title, value }: { title: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">{title}</p>
      <p className="mt-3 text-2xl font-semibold tracking-tight text-zinc-50">{value}</p>
    </div>
  );
}

function StatusBadge({ value }: { value: string | null }) {
  const text = value || "Unknown";

  return (
    <span className="inline-flex rounded-full border border-zinc-700 bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200">
      {text}
    </span>
  );
}

function CancelledBadge({ canceled }: { canceled: boolean | null }) {
  return canceled ? (
    <span className="inline-flex rounded-full border border-red-800/80 bg-red-950/60 px-2.5 py-1 text-xs font-medium text-red-200">
      Yes
    </span>
  ) : (
    <span className="inline-flex rounded-full border border-emerald-800/80 bg-emerald-950/50 px-2.5 py-1 text-xs font-medium text-emerald-200">
      No
    </span>
  );
}

export default async function ClientBookingsReportPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const client = decodeURIComponent(params.client ?? "").trim();
  const limit = getLimit(params.limit);
  const clientQuery = encodeURIComponent(params.client ?? "");
  const baseHref = `/acuity/dashboard/client-bookings?client=${clientQuery}`;

  if (!client) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-12 sm:px-10 lg:px-12">
          <Link href="/" className="text-sm text-zinc-400 hover:text-zinc-100">
            ← Back to Dashboard
          </Link>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            Client Bookings Report
          </h1>
          <p className="text-sm text-red-300">Invalid or missing client.</p>
        </div>
      </main>
    );
  }

  const appointments =
    limit === null
      ? await sql<AppointmentRow[]>`
          SELECT
            a.acuity_appointment_id,
            a.appointment_datetime,
            a.created_datetime,
            a.client_first_name,
            a.client_last_name,
            a.client_email,
            a.client_phone,
            a.appointment_type_name,
            a.calendar_name,
            a.price,
            a.paid_status,
            a.canceled
          FROM acuity_appointments a
          LEFT JOIN acuity_clients c ON c.id = a.client_id
          WHERE coalesce(
            nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
            c.email,
            a.client_email,
            'Unknown client'
          ) = ${client}
          ORDER BY a.appointment_datetime DESC;
        `
      : await sql<AppointmentRow[]>`
          SELECT
            a.acuity_appointment_id,
            a.appointment_datetime,
            a.created_datetime,
            a.client_first_name,
            a.client_last_name,
            a.client_email,
            a.client_phone,
            a.appointment_type_name,
            a.calendar_name,
            a.price,
            a.paid_status,
            a.canceled
          FROM acuity_appointments a
          LEFT JOIN acuity_clients c ON c.id = a.client_id
          WHERE coalesce(
            nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
            c.email,
            a.client_email,
            'Unknown client'
          ) = ${client}
          ORDER BY a.appointment_datetime DESC
          LIMIT ${limit};
        `;

  const totalRows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count
    FROM acuity_appointments a
    LEFT JOIN acuity_clients c ON c.id = a.client_id
    WHERE coalesce(
      nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
      c.email,
      a.client_email,
      'Unknown client'
    ) = ${client};
  `;

  const totalCount = totalRows[0]?.count ?? appointments.length;

  const totalPriceRows = await sql<{ total: string | number | null }[]>`
    SELECT SUM(COALESCE(a.price, 0)) AS total
    FROM acuity_appointments a
    LEFT JOIN acuity_clients c ON c.id = a.client_id
    WHERE coalesce(
      nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''),
      c.email,
      a.client_email,
      'Unknown client'
    ) = ${client};
  `;

  const totalPrice = totalPriceRows[0]?.total ?? 0;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-12 sm:px-10 lg:px-12">
        <header className="space-y-3">
          <Link href="/" className="inline-block text-sm text-zinc-400 hover:text-zinc-100">
            ← Back to Dashboard
          </Link>

          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">
              Top 10 clients by total bookings
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              Appointment records for <span className="font-medium text-zinc-200">{client}</span>.
            </p>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-3">
          <SummaryCard title="Client" value={client} />
          <SummaryCard title="Total bookings" value={totalCount} />
          <SummaryCard title="Listed price total" value={formatMoney(totalPrice)} />
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/70">
          <div className="flex flex-col gap-4 border-b border-zinc-800 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-medium text-zinc-50">Client appointment records</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Showing {appointments.length} of {totalCount} records.
              </p>
            </div>

            <div className="flex gap-2">
              {[
                ["30", "30"],
                ["100", "100"],
                ["All", "all"],
              ].map(([label, value]) => {
                const active =
                  (value === "all" && limit === null) ||
                  (value !== "all" && limit === Number(value));

                return (
                  <Link
                    key={value}
                    href={`${baseHref}&limit=${value}`}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                      active
                        ? "border-cyan-500 bg-cyan-500/10 text-cyan-200"
                        : "border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="max-h-[620px] w-full overflow-auto">
            <table className="min-w-[1650px] divide-y divide-zinc-800 text-sm">
              <thead className="sticky top-0 z-10 bg-zinc-950/95 text-xs uppercase tracking-[0.16em] text-zinc-500">
                <tr>
                  <th className="w-[190px] px-5 py-3 text-left font-medium">Appointment</th>
                  <th className="w-[190px] px-5 py-3 text-left font-medium">Created</th>
                  <th className="w-[180px] px-5 py-3 text-left font-medium">Client</th>
                  <th className="w-[280px] px-5 py-3 text-left font-medium">Email</th>
                  <th className="w-[150px] px-5 py-3 text-left font-medium">Phone</th>
                  <th className="w-[180px] px-5 py-3 text-left font-medium">Type</th>
                  <th className="w-[160px] px-5 py-3 text-left font-medium">Calendar</th>
                  <th className="w-[130px] px-5 py-3 text-right font-medium">Price</th>
                  <th className="w-[150px] px-5 py-3 text-left font-medium">Paid</th>
                  <th className="w-[130px] px-5 py-3 text-left font-medium">Cancelled</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {appointments.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-8 text-center text-zinc-400">
                      No bookings found for this client.
                    </td>
                  </tr>
                ) : (
                  appointments.map((row) => (
                    <tr
                      key={
                        row.acuity_appointment_id ??
                        `${row.appointment_datetime}-${row.client_email}`
                      }
                      className="hover:bg-zinc-800/40"
                    >
                      <td className="whitespace-nowrap px-5 py-3 font-medium text-zinc-100">
                        {formatDateTime(row.appointment_datetime)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-zinc-300">
                        {formatDateTime(row.created_datetime)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="max-w-[160px] truncate font-medium text-zinc-100">
                          {clientName(row)}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="max-w-[260px] truncate text-zinc-300">
                          {row.client_email ?? "—"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-zinc-300">
                        {row.client_phone ?? "—"}
                      </td>
                      <td className="px-5 py-3">
                        <div className="max-w-[170px] truncate text-zinc-300">
                          {row.appointment_type_name ?? "—"}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <div className="max-w-[150px] truncate text-zinc-300">
                          {row.calendar_name ?? "—"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-zinc-100">
                        {formatMoney(row.price)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge value={row.paid_status} />
                      </td>
                      <td className="px-5 py-3">
                        <CancelledBadge canceled={row.canceled} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
