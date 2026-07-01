import { sql } from "@/lib/db";
import { tryAutoSyncAcuityAppointmentsOnAppOpen } from "@/lib/acuity/auto-sync";
import AcuityDashboardCharts from "@/app/components/AcuityDashboardCharts";

export const dynamic = "force-dynamic";

type Point = { month_label: string; booking_count: number };
type ClientPoint = { client_name: string; booking_count: number };
type CalendarMonthPoint = { month_label: string; calendar_name: string; booking_count: number };

export default async function Home() {
  await tryAutoSyncAcuityAppointmentsOnAppOpen();

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

        <AcuityDashboardCharts
          appointmentMonthly={appointmentMonthly}
          bookingCreatedMonthly={bookingCreatedMonthly}
          topClients={topClients}
          calendarMonthly={calendarMonthly}
        />
      </main>
    </div>
  );
}
