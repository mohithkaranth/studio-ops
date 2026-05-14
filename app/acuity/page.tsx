import { sql } from "@/lib/db";

const ACUITY_APPOINTMENTS_URL = "https://acuityscheduling.com/api/v1/appointments";

type AcuityAppointment = {
  id: number;
  firstName?: string;
  lastName?: string;
  email?: string;
  datetime?: string;
  datetimeCreated?: string;
  created?: string;
  canceled?: boolean;
};

type CalendarMonthRow = { month_label: string; calendar_name: string; booking_count: number };

type SearchParams = Record<string, string | string[] | undefined>;
type ReportKey = "appointment-date" | "booking-date" | "top-clients" | "cancellations" | "calendar-month";

const REPORT_COPY: Record<ReportKey, { heading: string; explanation: string }> = {
  "appointment-date": {
    heading: "Monthly bookings by appointment date",
    explanation: "Groups bookings by the month when the appointment occurs.",
  },
  "booking-date": {
    heading: "Monthly bookings by booking created date",
    explanation: "Groups bookings by the month when the booking was created.",
  },
  "top-clients": {
    heading: "Top 10 clients by total number of bookings",
    explanation: "Ranks clients by booking count within the selected date range.",
  },
  cancellations: {
    heading: "Monthly bookings vs cancellations",
    explanation: "Compares monthly booking totals against cancellations.",
  },
  "calendar-month": {
    heading: "Bookings by calendar name per month",
    explanation: "Shows booking volume by room/calendar across appointment months.",
  },
};

function normalizeQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function monthKey(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  if (key === "Unknown") return key;
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, (month || 1) - 1, 1)));
}

function getCreatedTimestamp(appointment: AcuityAppointment) {
  return appointment.datetimeCreated ?? appointment.created;
}

async function fetchAppointments(): Promise<AcuityAppointment[]> {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;
  if (!userId || !apiKey) {
    throw new Error("Missing ACUITY_USER_ID or ACUITY_API_KEY environment variables.");
  }

  const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString("base64")}`;
  const url = new URL(ACUITY_APPOINTMENTS_URL);
  url.searchParams.set("max", "100");
  url.searchParams.set("direction", "ASC");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Acuity request failed with status ${response.status}.`);
  }

  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as AcuityAppointment[]).slice(0, 100) : [];
}

export default async function AcuityPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const rawReport = normalizeQueryValue(searchParams.report);
  const report: ReportKey =
    rawReport === "booking-date" || rawReport === "top-clients" || rawReport === "cancellations" || rawReport === "calendar-month"
      ? rawReport
      : "appointment-date";

  let detailRows: Array<{ c1: string; c2: string; c3: string }> = [];
  let errorMessage = "";

  if (report === "calendar-month") {
    try {
      const rows = await sql<CalendarMonthRow[]>`
        select
          date_trunc('month', appointment_datetime) as month_start,
          to_char(date_trunc('month', appointment_datetime), 'Mon-YY') as month_label,
          coalesce(calendar_name, 'Unknown') as calendar_name,
          count(*)::int as booking_count
        from acuity_appointments
        where appointment_datetime is not null
          and appointment_datetime >= date_trunc('month', current_date) - interval '11 months'
        group by month_start, month_label, calendar_name
        order by month_start, calendar_name;
      `;
      detailRows = rows.map((row) => ({ c1: row.month_label, c2: row.calendar_name, c3: String(row.booking_count) }));
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to load calendar month data.";
    }
  } else {
    let appointments: AcuityAppointment[] = [];
    try {
      appointments = await fetchAppointments();
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unable to fetch appointments.";
    }

    detailRows = (() => {
      if (report === "top-clients") {
        const byClient = new Map<string, number>();
        for (const appointment of appointments) {
          const client = `${appointment.firstName ?? ""} ${appointment.lastName ?? ""}`.trim() || "Unknown";
          byClient.set(client, (byClient.get(client) ?? 0) + 1);
        }
        return [...byClient.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 10)
          .map(([name, count]) => ({ c1: name, c2: String(count), c3: "" }));
      }

      if (report === "cancellations") {
        const byMonth = new Map<string, { bookings: number; cancellations: number }>();
        for (const appointment of appointments) {
          const key = monthKey(appointment.datetime);
          const bucket = byMonth.get(key) ?? { bookings: 0, cancellations: 0 };
          bucket.bookings += 1;
          if (appointment.canceled) bucket.cancellations += 1;
          byMonth.set(key, bucket);
        }
        return [...byMonth.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([month, counts]) => ({ c1: monthLabel(month), c2: String(counts.bookings), c3: String(counts.cancellations) }));
      }

      const byMonth = new Map<string, number>();
      for (const appointment of appointments) {
        const key = report === "booking-date" ? monthKey(getCreatedTimestamp(appointment)) : monthKey(appointment.datetime);
        byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
      }
      return [...byMonth.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, count]) => ({ c1: monthLabel(month), c2: String(count), c3: "" }));
    })();
  }

  const columns =
    report === "top-clients"
      ? ["Client", "Bookings"]
      : report === "cancellations"
        ? ["Month", "Bookings", "Cancellations"]
        : report === "calendar-month"
          ? ["Month", "Calendar", "Bookings"]
          : ["Month", "Bookings"];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-12 sm:px-10 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50 sm:text-4xl">{REPORT_COPY[report].heading}</h1>
          <p className="text-sm text-zinc-400 sm:text-base">{REPORT_COPY[report].explanation}</p>
        </header>

        {errorMessage ? (
          <div className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">{errorMessage}</div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-zinc-800 bg-zinc-900/80">
            <table className="min-w-full divide-y divide-zinc-800 text-left text-sm">
              <thead className="bg-zinc-900 text-zinc-300">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="px-4 py-3 font-medium">{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-200">
                {detailRows.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="px-4 py-6 text-center text-zinc-400">No data found.</td>
                  </tr>
                ) : (
                  detailRows.map((row) => (
                    <tr key={`${row.c1}-${row.c2}-${row.c3}`} className="hover:bg-zinc-900">
                      <td className="px-4 py-3">{row.c1}</td>
                      <td className="px-4 py-3">{row.c2}</td>
                      {columns.length === 3 ? <td className="px-4 py-3">{row.c3}</td> : null}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
