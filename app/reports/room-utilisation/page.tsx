import Link from "next/link";
import RoomUtilisationFilters from "./RoomUtilisationFilters";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

type AppointmentRow = {
  appointment_date_sgt: string;
  appointment_time_sgt: string;
  created_time_sgt: string | null;
  client_name: string;
  appointment_type_name: string | null;
  calendar_name: string;
  price: string | number | null;
  paid_status: string | null;
};

type DateCountRow = {
  date: string;
  total: number;
  livingRoom: number;
  bedroom: number;
};

const DEFAULT_CALENDARS = ["Living Room", "Bedroom"];
const calendarOptions = DEFAULT_CALENDARS;
const timePattern = /^\d{2}:\d{2}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const sgdFormatter = new Intl.NumberFormat("en-SG", {
  style: "currency",
  currency: "SGD",
});

function singaporeToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function firstDayOfMonth(date: string) {
  return `${date.slice(0, 8)}01`;
}

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normaliseDate(value: string | string[] | undefined, fallback: string) {
  const candidate = firstValue(value);
  return candidate && datePattern.test(candidate) ? candidate : fallback;
}

function normaliseTime(value: string | string[] | undefined, fallback: string) {
  const candidate = firstValue(value);
  return candidate && timePattern.test(candidate) ? candidate : fallback;
}

function normaliseCalendars(value: string | string[] | undefined) {
  const selected = firstValue(value)
    ?.split(",")
    .map((calendar) => calendar.trim())
    .filter((calendar) => calendarOptions.includes(calendar));

  return selected && selected.length > 0 ? selected : DEFAULT_CALENDARS;
}

function numberValue(value: string | number | null) {
  if (value === null) return 0;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatPrice(value: string | number | null) {
  if (value === null) return "—";
  return sgdFormatter.format(numberValue(value));
}

function SummaryCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">
        {title}
      </p>
      <p className="mt-2 text-2xl font-semibold text-zinc-50">{value}</p>
    </div>
  );
}

export default async function RoomUtilisationPage(props: {
  searchParams: SearchParams;
}) {
  const searchParams = await props.searchParams;
  const today = singaporeToday();
  const filters = {
    dateFrom: normaliseDate(searchParams.dateFrom, firstDayOfMonth(today)),
    dateTo: normaliseDate(searchParams.dateTo, today),
    timeFrom: normaliseTime(searchParams.timeFrom, "10:00"),
    timeTo: normaliseTime(searchParams.timeTo, "16:00"),
    calendars: normaliseCalendars(searchParams.calendars),
  };

  const appointments = await sql<AppointmentRow[]>`
    SELECT
      TO_CHAR((appointment_datetime AT TIME ZONE 'Asia/Singapore')::date, 'YYYY-MM-DD') AS appointment_date_sgt,
      TO_CHAR(appointment_datetime AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD HH24:MI') AS appointment_time_sgt,
      TO_CHAR(created_datetime AT TIME ZONE 'Asia/Singapore', 'YYYY-MM-DD HH24:MI') AS created_time_sgt,
      COALESCE(NULLIF(trim(client_first_name || ' ' || client_last_name), ''), client_email, 'Unknown') AS client_name,
      appointment_type_name,
      calendar_name,
      price,
      paid_status
    FROM acuity_appointments
    WHERE appointment_datetime IS NOT NULL
      AND COALESCE(canceled, false) IS FALSE
      AND appointment_datetime >= (${filters.dateFrom}::date::timestamp AT TIME ZONE 'Asia/Singapore')
      AND appointment_datetime < ((${filters.dateTo}::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Singapore')
      AND (appointment_datetime AT TIME ZONE 'Asia/Singapore')::time >= ${filters.timeFrom}::time
      AND (appointment_datetime AT TIME ZONE 'Asia/Singapore')::time < ${filters.timeTo}::time
      AND calendar_name = ANY(${filters.calendars}::text[])
    ORDER BY appointment_datetime ASC;
  `;

  const totalAppointments = appointments.length;
  const livingRoomCount = appointments.filter(
    (row) => row.calendar_name === "Living Room",
  ).length;
  const bedroomCount = appointments.filter(
    (row) => row.calendar_name === "Bedroom",
  ).length;

  const dateCounts = [
    ...appointments
      .reduce((counts, row) => {
        const existing = counts.get(row.appointment_date_sgt) ?? {
          date: row.appointment_date_sgt,
          total: 0,
          livingRoom: 0,
          bedroom: 0,
        };
        existing.total += 1;
        if (row.calendar_name === "Living Room") existing.livingRoom += 1;
        if (row.calendar_name === "Bedroom") existing.bedroom += 1;
        counts.set(row.appointment_date_sgt, existing);
        return counts;
      }, new Map<string, DateCountRow>())
      .values(),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const calendarCounts = [
    ...appointments
      .reduce((counts, row) => {
        counts.set(row.calendar_name, (counts.get(row.calendar_name) ?? 0) + 1);
        return counts;
      }, new Map<string, number>())
      .entries(),
  ]
    .map(([calendar, count]) => ({ calendar, count }))
    .sort((a, b) => b.count - a.count || a.calendar.localeCompare(b.calendar));

  return (
    <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
            Room Utilisation
          </h1>
          <p className="text-sm text-zinc-400">
            Acuity appointments for Living Room and Bedroom by selected
            Singapore dates and times.
          </p>
        </header>

        <RoomUtilisationFilters
          dateFrom={filters.dateFrom}
          dateTo={filters.dateTo}
          timeFrom={filters.timeFrom}
          timeTo={filters.timeTo}
          calendars={filters.calendars}
        />

        <section className="grid gap-4 sm:grid-cols-3">
          <SummaryCard
            title="Total appointments"
            value={totalAppointments.toLocaleString("en-SG")}
          />
          <SummaryCard
            title="Living Room count"
            value={livingRoomCount.toLocaleString("en-SG")}
          />
          <SummaryCard
            title="Bedroom count"
            value={bedroomCount.toLocaleString("en-SG")}
          />
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <ReportTable
            title="Count by Singapore appointment date"
            headers={["Date", "Total", "Living Room", "Bedroom"]}
            rows={dateCounts.map((row) => [
              row.date,
              row.total,
              row.livingRoom,
              row.bedroom,
            ])}
          />
          <ReportTable
            title="Count by calendar"
            headers={["Calendar", "Count"]}
            rows={calendarCounts.map((row) => [row.calendar, row.count])}
          />
        </section>

        <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
          <div className="border-b border-zinc-800 px-4 py-3">
            <h2 className="text-lg font-medium text-zinc-100">
              Appointment details
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-800 text-sm">
              <thead className="bg-zinc-950/70 text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  {[
                    "Appointment Time SGT",
                    "Created Time SGT",
                    "Client",
                    "Appointment Type",
                    "Calendar",
                    "Price",
                    "Paid Status",
                  ].map((header) => (
                    <th key={header} className="px-4 py-3 font-medium">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-300">
                {appointments.length === 0 ? (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-zinc-500"
                    >
                      No appointments found for the selected filters.
                    </td>
                  </tr>
                ) : (
                  appointments.map((appointment) => (
                    <tr
                      key={`${appointment.appointment_time_sgt}-${appointment.client_name}-${appointment.calendar_name}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3">
                        {appointment.appointment_time_sgt}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {appointment.created_time_sgt ?? "—"}
                      </td>
                      <td className="px-4 py-3">{appointment.client_name}</td>
                      <td className="px-4 py-3">
                        {appointment.appointment_type_name ?? "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {appointment.calendar_name}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatPrice(appointment.price)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {appointment.paid_status ?? "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <Link
          href="/"
          className="inline-block text-sm text-zinc-400 hover:text-zinc-100"
        >
          ← Back to Dashboard
        </Link>
      </div>
    </main>
  );
}

function ReportTable({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
      <div className="border-b border-zinc-800 px-4 py-3">
        <h2 className="text-lg font-medium text-zinc-100">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-950/70 text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {headers.map((header) => (
                <th key={header} className="px-4 py-3 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800 text-zinc-300">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={headers.length}
                  className="px-4 py-6 text-center text-zinc-500"
                >
                  No results found.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.join("-")}>
                  {row.map((cell, index) => (
                    <td
                      key={`${cell}-${index}`}
                      className="whitespace-nowrap px-4 py-3"
                    >
                      {typeof cell === "number"
                        ? cell.toLocaleString("en-SG")
                        : cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
