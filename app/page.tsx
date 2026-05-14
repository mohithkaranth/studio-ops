import Link from "next/link";

import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type Point = { month_label: string; booking_count: number };
type ClientPoint = { client_name: string; booking_count: number };
type CalendarMonthPoint = { month_label: string; calendar_name: string; booking_count: number };

type Tick = { value: number; y: number };

function EmptyState() {
  return <div className="flex h-72 items-center justify-center text-sm text-zinc-500">No data available for the last 12 months.</div>;
}

function buildTicks(max: number, chartTop: number, chartHeight: number): Tick[] {
  const safeMax = Math.max(max, 1);
  const midpoint = Math.round(safeMax / 2);
  return [0, midpoint, safeMax].map((value) => ({ value, y: chartTop + chartHeight - (value / safeMax) * chartHeight }));
}

function LineChart({ data, color }: { data: Point[]; color: string }) {
  if (data.length === 0) return <EmptyState />;
  const max = Math.max(...data.map((d) => d.booking_count), 1);
  const width = 720;
  const height = 260;
  const margin = { top: 20, right: 16, bottom: 60, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const stepX = data.length > 1 ? innerW / (data.length - 1) : innerW;
  const ticks = buildTicks(max, margin.top, innerH);

  const points = data.map((d, i) => {
    const x = margin.left + i * stepX;
    const y = margin.top + innerH - (d.booking_count / max) * innerH;
    return { ...d, x, y };
  });

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full" role="img" aria-label="Line chart">
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={margin.left} y1={tick.y} x2={width - margin.right} y2={tick.y} stroke="#27272a" strokeDasharray="4 4" />
          <text x={margin.left - 8} y={tick.y + 4} textAnchor="end" className="fill-zinc-400 text-[11px]">{tick.value}</text>
        </g>
      ))}
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      <polyline fill="none" stroke={color} strokeWidth="3" points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
      {points.map((p) => (
        <g key={p.month_label}>
          <circle cx={p.x} cy={p.y} r="4" fill={color}>
            <title>{`${p.month_label}: ${p.booking_count}`}</title>
          </circle>
          <text x={p.x} y={p.y - 8} textAnchor="middle" className="fill-zinc-300 text-[10px]">{p.booking_count}</text>
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
  const margin = { top: 16, right: 16, bottom: 105, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  const barW = Math.max(14, Math.floor(innerW / Math.max(data.length * 1.7, 1)));
  const gap = (innerW - barW * data.length) / Math.max(data.length - 1, 1);
  const ticks = buildTicks(max, margin.top, innerH);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full" role="img" aria-label="Bar chart">
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={margin.left} y1={tick.y} x2={width - margin.right} y2={tick.y} stroke="#27272a" strokeDasharray="4 4" />
          <text x={margin.left - 8} y={tick.y + 4} textAnchor="end" className="fill-zinc-400 text-[11px]">{tick.value}</text>
        </g>
      ))}
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />
      {data.map((d, i) => {
        const h = (d.booking_count / max) * innerH;
        const x = margin.left + i * (barW + gap);
        const y = margin.top + innerH - h;
        return (
          <g key={d.client_name}>
            <rect x={x} y={y} width={barW} height={h} fill="#60a5fa" rx="2">
              <title>{`${d.client_name}: ${d.booking_count}`}</title>
            </rect>
            <text x={x + barW / 2} y={y - 6} textAnchor="middle" className="fill-zinc-300 text-[10px]">{d.booking_count}</text>
            <text x={x + barW / 2} y={height - 50} textAnchor="end" transform={`rotate(-45 ${x + barW / 2} ${height - 50})`} className="fill-zinc-400 text-[10px]">{d.client_name}</text>
          </g>
        );
      })}
    </svg>
  );
}

function CalendarMonthChart({ data }: { data: CalendarMonthPoint[] }) {
  if (data.length === 0) return <EmptyState />;

  const width = 720;
  const height = 300;
  const margin = { top: 28, right: 20, bottom: 75, left: 52 };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const months = [...new Set(data.map((d) => d.month_label))];
  const calendars = [...new Set(data.map((d) => d.calendar_name))];
  const max = Math.max(...data.map((d) => d.booking_count), 1);
  const ticks = buildTicks(max, margin.top, innerH);
  const monthW = innerW / Math.max(months.length, 1);
  const groupW = monthW * 0.8;
  const barW = Math.max(6, groupW / Math.max(calendars.length, 1) - 4);
  const colors = ["#22d3ee", "#f59e0b", "#a78bfa", "#34d399", "#f87171", "#60a5fa"];
  const byKey = new Map(data.map((d) => [`${d.month_label}||${d.calendar_name}`, d.booking_count]));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-80 w-full" role="img" aria-label="Calendar monthly bookings chart">
      {ticks.map((tick) => (
        <g key={tick.value}>
          <line x1={margin.left} y1={tick.y} x2={width - margin.right} y2={tick.y} stroke="#27272a" strokeDasharray="4 4" />
          <text x={margin.left - 8} y={tick.y + 4} textAnchor="end" className="fill-zinc-400 text-[11px]">{tick.value}</text>
        </g>
      ))}
      <line x1={margin.left} y1={margin.top + innerH} x2={width - margin.right} y2={margin.top + innerH} stroke="#52525b" />
      <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="#52525b" />

      {months.map((month, i) => {
        const gx = margin.left + i * monthW + (monthW - groupW) / 2;
        return (
          <g key={month}>
            {calendars.map((calendar, cIdx) => {
              const value = byKey.get(`${month}||${calendar}`) ?? 0;
              const h = (value / max) * innerH;
              const x = gx + cIdx * (barW + 3);
              const y = margin.top + innerH - h;
              return (
                <g key={`${month}-${calendar}`}>
                  <rect x={x} y={y} width={barW} height={h} fill={colors[cIdx % colors.length]} rx="2">
                    <title>{`${month} • ${calendar}: ${value}`}</title>
                  </rect>
                </g>
              );
            })}
            <text x={gx + groupW / 2} y={height - 46} textAnchor="middle" className="fill-zinc-400 text-[10px]">{month}</text>
          </g>
        );
      })}

      {calendars.map((calendar, i) => (
        <g key={calendar}>
          <rect x={margin.left + i * 110} y={8} width={10} height={10} fill={colors[i % colors.length]} />
          <text x={margin.left + i * 110 + 14} y={17} className="fill-zinc-300 text-[11px]">{calendar}</text>
        </g>
      ))}
    </svg>
  );
}

export default async function Home() {
  const [appointmentMonthly, bookingCreatedMonthly, topClients, calendarMonthly] = await Promise.all([
    sql<Point[]>`select date_trunc('month', appointment_datetime) as month_start,to_char(date_trunc('month', appointment_datetime), 'Mon-YY') as month_label,count(*)::int as booking_count from acuity_appointments where appointment_datetime is not null and appointment_datetime >= date_trunc('month', current_date) - interval '11 months' group by month_start, month_label order by month_start;`,
    sql<Point[]>`select date_trunc('month', created_datetime) as month_start,to_char(date_trunc('month', created_datetime), 'Mon-YY') as month_label,count(*)::int as booking_count from acuity_appointments where created_datetime is not null and created_datetime >= date_trunc('month', current_date) - interval '11 months' group by month_start, month_label order by month_start;`,
    sql<ClientPoint[]>`select coalesce(nullif(trim(client_first_name || ' ' || client_last_name), ''),client_email,'Unknown') as client_name,count(*)::int as booking_count from acuity_appointments where appointment_datetime is not null and appointment_datetime >= date_trunc('month', current_date) - interval '11 months' group by client_name order by booking_count desc, client_name asc limit 10;`,
    sql<CalendarMonthPoint[]>`select date_trunc('month', appointment_datetime) as month_start,to_char(date_trunc('month', appointment_datetime), 'Mon-YY') as month_label,coalesce(calendar_name, 'Unknown') as calendar_name,count(*)::int as booking_count from acuity_appointments where appointment_datetime is not null and appointment_datetime >= date_trunc('month', current_date) - interval '11 months' group by month_start, month_label, calendar_name order by month_start, calendar_name;`,
  ]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-14 sm:px-10 lg:px-12">
        <header className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50">Acuity Dashboard</h1>
          <p className="text-sm text-zinc-400">Last 12 months of booking trends from synced Acuity data.</p>
        </header>

        <section className="grid gap-6 md:grid-cols-2">
          <Link href="/acuity?report=appointment-date" className="rounded-2xl border border-zinc-800/90 bg-zinc-900/70 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:border-zinc-700 hover:bg-zinc-900/90">
            <h2 className="text-lg font-medium">Bookings by appointment month</h2>
            <p className="mb-2 text-xs text-zinc-400">When booked sessions are scheduled to happen.</p>
            <LineChart data={appointmentMonthly} color="#22d3ee" />
          </Link>

          <Link href="/acuity?report=booking-date" className="rounded-2xl border border-zinc-800/90 bg-zinc-900/70 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:border-zinc-700 hover:bg-zinc-900/90">
            <h2 className="text-lg font-medium">Bookings by booking created month</h2>
            <p className="mb-2 text-xs text-zinc-400">When customers created their bookings.</p>
            <LineChart data={bookingCreatedMonthly} color="#a78bfa" />
          </Link>

          <Link href="/acuity?report=top-clients" className="rounded-2xl border border-zinc-800/90 bg-zinc-900/70 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:border-zinc-700 hover:bg-zinc-900/90">
            <h2 className="text-lg font-medium">Top 10 clients by total bookings</h2>
            <p className="mb-2 text-xs text-zinc-400">Highest frequency clients in the last 12 months.</p>
            <VerticalBarChart data={topClients} />
          </Link>

          <Link href="/acuity?report=calendar-month" className="rounded-2xl border border-zinc-800/90 bg-zinc-900/70 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.25)] transition hover:border-zinc-700 hover:bg-zinc-900/90">
            <h2 className="text-lg font-medium">Bookings by calendar name per appointment month</h2>
            <p className="mb-2 text-xs text-zinc-400">Monthly room/calendar booking mix.</p>
            <CalendarMonthChart data={calendarMonthly} />
          </Link>
        </section>
      </main>
    </div>
  );
}
