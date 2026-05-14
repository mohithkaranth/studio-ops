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

type Point = { label: string; value: number };
type DualPoint = { label: string; bookings: number; cancellations: number };

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
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

function getCreatedTimestamp(appointment: AcuityAppointment) {
  return appointment.datetimeCreated ?? appointment.created;
}

async function fetchAppointments(): Promise<AcuityAppointment[]> {
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;
  if (!userId || !apiKey) return [];

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

function EmptyState() {
  return <div className="flex h-72 items-center justify-center text-sm text-zinc-500">Not enough data to render chart.</div>;
}

function LineChart({ data, color }: { data: Point[]; color: string }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const width = 720;
  const height = 260;
  const margin = { top: 20, right: 16, bottom: 60, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((d, i) => {
    const x = margin.left + i * stepX;
    const y = margin.top + innerH - (d.value / max) * innerH;
    return { ...d, x, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full" role="img" aria-label="Line chart">
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        points={points.map((p) => `${p.x},${p.y}`).join(" ")}
      />
      {points.map((p) => (
        <g key={p.label}>
          <circle cx={p.x} cy={p.y} r="3" fill={color} />
          <text x={p.x} y={height - 24} textAnchor="middle" className="fill-zinc-400 text-[11px]">{p.label}</text>
        </g>
      ))}
    </svg>
  );
}

function VerticalBarChart({ data }: { data: Point[] }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => d.value), 1);
  const width = 720;
  const height = 320;
  const margin = { top: 16, right: 16, bottom: 90, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const barW = Math.max(14, Math.floor(innerW / Math.max(data.length * 1.7, 1)));
  const gap = (innerW - barW * data.length) / Math.max(data.length - 1, 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full" role="img" aria-label="Bar chart">
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      {data.map((d, i) => {
        const h = (d.value / max) * innerH;
        const x = margin.left + i * (barW + gap);
        const y = margin.top + innerH - h;
        return (
          <g key={d.label}>
            <rect x={x} y={y} width={barW} height={h} fill="#60a5fa" rx="2" />
            <text x={x + barW / 2} y={height - 52} textAnchor="end" transform={`rotate(-45 ${x + barW / 2} ${height - 52})`} className="fill-zinc-400 text-[10px]">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function GroupedBarChart({ data }: { data: DualPoint[] }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => Math.max(d.bookings, d.cancellations)), 1);
  const width = 720;
  const height = 280;
  const margin = { top: 20, right: 16, bottom: 65, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const groupW = innerW / data.length;
  const barW = Math.max(6, Math.min(18, groupW / 3));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full" role="img" aria-label="Grouped bar chart">
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      {data.map((d, i) => {
        const gx = margin.left + i * groupW + groupW / 2;
        const bookH = (d.bookings / max) * innerH;
        const cancelH = (d.cancellations / max) * innerH;
        return (
          <g key={d.label}>
            <rect x={gx - barW - 2} y={margin.top + innerH - bookH} width={barW} height={bookH} fill="#22c55e" rx="2" />
            <rect x={gx + 2} y={margin.top + innerH - cancelH} width={barW} height={cancelH} fill="#f87171" rx="2" />
            <text x={gx} y={height - 25} textAnchor="middle" className="fill-zinc-400 text-[10px]">{d.label}</text>
          </g>
        );
      })}
      <text x={width - 130} y={20} className="fill-zinc-300 text-[11px]">■ Bookings</text>
      <text x={width - 60} y={20} className="fill-zinc-300 text-[11px]">■ Cancellations</text>
    </svg>
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
    const client = `${appointment.firstName ?? ""} ${appointment.lastName ?? ""}`.trim() || "Unknown";
    byClient.set(client, (byClient.get(client) ?? 0) + 1);
    const stats = byMonthStats.get(appointmentMonth) ?? { bookings: 0, cancellations: 0 };
    stats.bookings += 1;
    if (appointment.canceled) stats.cancellations += 1;
    byMonthStats.set(appointmentMonth, stats);
  }

  const appointmentSeries = [...byAppointmentMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ label: monthLabel(k), value: v }));
  const bookingSeries = [...byBookingMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ label: monthLabel(k), value: v }));
  const topClients = [...byClient.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([label, value]) => ({ label, value }));
  const cancellationsSeries = [...byMonthStats.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => ({ label: monthLabel(k), bookings: v.bookings, cancellations: v.cancellations }));

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-14 sm:px-10 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50">Acuity Dashboard</h1>
          <p className="text-sm text-zinc-400">Monthly booking and client trends from existing Acuity appointments.</p>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <Link href="/acuity?report=appointment-date" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Bookings by appointment month</h2>
            <p className="mb-2 text-xs text-zinc-400">X-axis month, Y-axis bookings.</p>
            <LineChart data={appointmentSeries} color="#22d3ee" />
          </Link>

          <Link href="/acuity?report=booking-date" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Bookings by booking-created month</h2>
            <p className="mb-2 text-xs text-zinc-400">X-axis month, Y-axis bookings.</p>
            <LineChart data={bookingSeries} color="#a78bfa" />
          </Link>

          <Link href="/acuity?report=top-clients" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Top 10 clients by total bookings</h2>
            <p className="mb-2 text-xs text-zinc-400">Sorted descending by total bookings.</p>
            <VerticalBarChart data={topClients} />
          </Link>

          <Link href="/acuity?report=cancellations" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Bookings vs cancellations by month</h2>
            <p className="mb-2 text-xs text-zinc-400">Two series: bookings and cancellations per month.</p>
            <GroupedBarChart data={cancellationsSeries} />
          </Link>
        </section>
      </main>
    </div>
  );
}
