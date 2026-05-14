import Link from "next/link";

const ACUITY_APPOINTMENTS_URL = "https://acuityscheduling.com/api/v1/appointments";

type AcuityAppointment = {
  id: number;
  firstName?: string;
  lastName?: string;
  datetime?: string;
  datetimeCreated?: string;
  created?: string;
  canceled?: boolean;
};

function monthKey(value?: string) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  if (key === "Unknown") return key;
  const [year, month] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "2-digit" }).format(date);
}

function getCreatedTimestamp(appointment: AcuityAppointment) {
  return appointment.datetimeCreated ?? appointment.created;
}

async function fetchAppointments(): Promise<AcuityAppointment[]> {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;
  if (!userId || !apiKey) {
    return [];
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

  if (!response.ok) return [];
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as AcuityAppointment[]).slice(0, 100) : [];
}

function bars(items: Array<{ label: string; value: number }>) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex justify-between text-xs text-zinc-300">
            <span>{item.label}</span>
            <span>{item.value}</span>
          </div>
          <div className="h-2 rounded bg-zinc-800">
            <div className="h-2 rounded bg-zinc-400" style={{ width: `${(item.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function Home() {
  const appointments = await fetchAppointments();

  const byAppointmentMonth = new Map<string, number>();
  const byBookingMonth = new Map<string, number>();
  const byClient = new Map<string, number>();
  const byMonthStats = new Map<string, { bookings: number; cancellations: number }>();

  for (const appointment of appointments) {
    const appointmentMonth = monthKey(appointment.datetime);
    const bookingMonth = monthKey(getCreatedTimestamp(appointment));

    byAppointmentMonth.set(appointmentMonth, (byAppointmentMonth.get(appointmentMonth) ?? 0) + 1);
    byBookingMonth.set(bookingMonth, (byBookingMonth.get(bookingMonth) ?? 0) + 1);

    const clientName = `${appointment.firstName ?? ""} ${appointment.lastName ?? ""}`.trim() || "Unknown";
    byClient.set(clientName, (byClient.get(clientName) ?? 0) + 1);

    const monthStats = byMonthStats.get(appointmentMonth) ?? { bookings: 0, cancellations: 0 };
    monthStats.bookings += 1;
    if (appointment.canceled) monthStats.cancellations += 1;
    byMonthStats.set(appointmentMonth, monthStats);
  }

  const appointmentSeries = [...byAppointmentMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label: monthLabel(label), value }))
    .slice(-6);

  const bookingSeries = [...byBookingMonth.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([label, value]) => ({ label: monthLabel(label), value }))
    .slice(-6);

  const topClientsSeries = [...byClient.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));

  const cancellationsSeries = [...byMonthStats.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-6)
    .flatMap(([label, counts]) => [
      { label: `${monthLabel(label)} bookings`, value: counts.bookings },
      { label: `${monthLabel(label)} cancellations`, value: counts.cancellations },
    ]);

  const charts = [
    { title: "Monthly bookings by appointment date", href: "/acuity?report=appointment-date", data: appointmentSeries },
    { title: "Monthly bookings by booking created date", href: "/acuity?report=booking-date", data: bookingSeries },
    { title: "Top 10 clients by total number of bookings", href: "/acuity?report=top-clients", data: topClientsSeries },
    { title: "Monthly bookings vs cancellations", href: "/acuity?report=cancellations", data: cancellationsSeries },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-14 sm:px-10 lg:px-12">
        <header className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">Studio Ops</h1>
          <p className="max-w-2xl text-base text-zinc-400 sm:text-lg">Acuity reporting overview</p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {charts.map((chart) => (
            <Link
              key={chart.title}
              href={chart.href}
              className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900"
            >
              <h2 className="text-lg font-medium text-zinc-100">{chart.title}</h2>
              <p className="mt-2 text-xs text-zinc-400">Click to view detailed report</p>
              <div className="mt-4">{bars(chart.data)}</div>
            </Link>
          ))}
        </section>
      </main>
    </div>
  );
}
