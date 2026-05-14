import Link from "next/link";

import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Point = { month_label: string; booking_count: number };
type ClientPoint = { client_name: string; booking_count: number };
type DualPoint = { month_label: string; total_bookings: number; cancelled_bookings: number };

function EmptyState() {
  return <div className="flex h-72 items-center justify-center text-sm text-zinc-500">No data available for the last 12 months.</div>;
}

function LineChart({ data, color }: { data: Point[]; color: string }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => d.booking_count), 1);
  const width = 720;
  const height = 260;
  const margin = { top: 20, right: 16, bottom: 60, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const points = data.map((d, i) => {
    const x = margin.left + i * stepX;
    const y = margin.top + innerH - (d.booking_count / max) * innerH;
    return { ...d, x, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full" role="img" aria-label="Line chart">
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      <polyline fill="none" stroke={color} strokeWidth="3" points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
      {points.map((p) => (
        <g key={p.month_label}>
          <circle cx={p.x} cy={p.y} r="3" fill={color} />
          <text x={p.x} y={height - 24} textAnchor="middle" className="fill-zinc-400 text-[11px]">{p.month_label}</text>
        </g>
      ))}
    </svg>
  );
}

function VerticalBarChart({ data }: { data: ClientPoint[] }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => d.booking_count), 1);
  const width = 720;
  const height = 320;
  const margin = { top: 16, right: 16, bottom: 105, left: 44 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const barW = Math.max(14, Math.floor(innerW / Math.max(data.length * 1.7, 1)));
  const gap = (innerW - barW * data.length) / Math.max(data.length - 1, 1);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full" role="img" aria-label="Bar chart">
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      {data.map((d, i) => {
        const h = (d.booking_count / max) * innerH;
        const x = margin.left + i * (barW + gap);
        const y = margin.top + innerH - h;
        return (
          <g key={d.client_name}>
            <rect x={x} y={y} width={barW} height={h} fill="#60a5fa" rx="2" />
            <text x={x + barW / 2} y={height - 50} textAnchor="end" transform={`rotate(-45 ${x + barW / 2} ${height - 50})`} className="fill-zinc-400 text-[10px]">{d.client_name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function GroupedBarChart({ data }: { data: DualPoint[] }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => Math.max(d.total_bookings, d.cancelled_bookings)), 1);
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
        const bookH = (d.total_bookings / max) * innerH;
        const cancelH = (d.cancelled_bookings / max) * innerH;
        return (
          <g key={d.month_label}>
            <rect x={gx - barW - 2} y={margin.top + innerH - bookH} width={barW} height={bookH} fill="#22c55e" rx="2" />
            <rect x={gx + 2} y={margin.top + innerH - cancelH} width={barW} height={cancelH} fill="#f87171" rx="2" />
            <text x={gx} y={height - 25} textAnchor="middle" className="fill-zinc-400 text-[10px]">{d.month_label}</text>
          </g>
        );
      })}
      <text x={width - 130} y={20} className="fill-zinc-300 text-[11px]">■ Bookings</text>
      <text x={width - 60} y={20} className="fill-zinc-300 text-[11px]">■ Cancellations</text>
    </svg>
  );
}

export default async function Home() {
  const [appointmentMonthly, bookingCreatedMonthly, topClients, bookingsVsCancellations] = await Promise.all([
    sql<Point[]>`
      select
        date_trunc('month', appointment_datetime) as month_start,
        to_char(date_trunc('month', appointment_datetime), 'Mon-YY') as month_label,
        count(*)::int as booking_count
      from acuity_appointments
      where appointment_datetime is not null
        and appointment_datetime >= date_trunc('month', current_date) - interval '11 months'
      group by month_start, month_label
      order by month_start;
    `,
    sql<Point[]>`
      select
        date_trunc('month', created_datetime) as month_start,
        to_char(date_trunc('month', created_datetime), 'Mon-YY') as month_label,
        count(*)::int as booking_count
      from acuity_appointments
      where created_datetime is not null
        and created_datetime >= date_trunc('month', current_date) - interval '11 months'
      group by month_start, month_label
      order by month_start;
    `,
    sql<ClientPoint[]>`
      select
        coalesce(
          nullif(trim(client_first_name || ' ' || client_last_name), ''),
          client_email,
          'Unknown'
        ) as client_name,
        count(*)::int as booking_count
      from acuity_appointments
      where appointment_datetime is not null
        and appointment_datetime >= date_trunc('month', current_date) - interval '11 months'
      group by client_name
      order by booking_count desc, client_name asc
      limit 10;
    `,
    sql<DualPoint[]>`
      select
        date_trunc('month', appointment_datetime) as month_start,
        to_char(date_trunc('month', appointment_datetime), 'Mon-YY') as month_label,
        count(*)::int as total_bookings,
        count(*) filter (where canceled = true)::int as cancelled_bookings
      from acuity_appointments
      where appointment_datetime is not null
        and appointment_datetime >= date_trunc('month', current_date) - interval '11 months'
      group by month_start, month_label
      order by month_start;
    `,
  ]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-14 sm:px-10 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50">Acuity Dashboard</h1>
          <p className="text-sm text-zinc-400">Last 12 months from acuity_appointments.</p>
        </header>

        <section className="grid gap-4 lg:grid-cols-2">
          <Link href="/acuity?report=appointment-date" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Bookings by appointment month</h2>
            <p className="mb-2 text-xs text-zinc-400">Monthly trend by appointment_datetime.</p>
            <LineChart data={appointmentMonthly} color="#22d3ee" />
          </Link>

          <Link href="/acuity?report=booking-date" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Bookings by booking created month</h2>
            <p className="mb-2 text-xs text-zinc-400">Monthly trend by created_datetime.</p>
            <LineChart data={bookingCreatedMonthly} color="#a78bfa" />
          </Link>

          <Link href="/acuity?report=top-clients" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Top 10 clients by total bookings</h2>
            <p className="mb-2 text-xs text-zinc-400">Sorted descending by booking_count.</p>
            <VerticalBarChart data={topClients} />
          </Link>

          <Link href="/acuity?report=cancellations" className="rounded-2xl border border-zinc-800 bg-zinc-900/80 p-4 hover:border-zinc-700">
            <h2 className="text-lg font-medium">Bookings vs cancellations by appointment month</h2>
            <p className="mb-2 text-xs text-zinc-400">Two-series monthly comparison.</p>
            <GroupedBarChart data={bookingsVsCancellations} />
          </Link>
        </section>
      </main>
    </div>
  );
}
