import { getReconciliationPeriods } from "@/lib/reconciliation-period-data";
import YearlyUnsettled from "./YearlyUnsettled";

export const dynamic = "force-dynamic";
export default async function Page({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const query = await searchParams;
  const periods = await getReconciliationPeriods();
  const currentYear = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Singapore' }).format(new Date()));
  const years = [...new Set(periods.map(period => period.year))].filter(year => year <= currentYear);
  return <main className="min-h-screen w-full bg-zinc-950 text-zinc-100"><div className="mx-auto w-full max-w-7xl space-y-6 px-6 py-10">
    <h1 className="text-3xl font-semibold">Unsettled</h1>
    <p className="text-sm text-zinc-400">Compare unsettled bookings and unaccounted PayNow payments across the year. Package bookings and PayNow matched bookings are excluded.</p>
    <YearlyUnsettled key={query.year ?? 'default'} initialYear={years.includes(Number(query.year)) ? Number(query.year) : years[0] ?? currentYear} years={years} periods={periods} currentYear={currentYear} currentMonth={Number(new Intl.DateTimeFormat('en', { month: 'numeric', timeZone: 'Asia/Singapore' }).format(new Date()))} />
  </div></main>;
}
