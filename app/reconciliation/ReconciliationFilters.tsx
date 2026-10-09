"use client";

import { useState } from "react";
import { monthNames, type ReconciliationPeriod } from "@/lib/reconciliation-period";

export default function ReconciliationFilters({ periods, initialYear, initialMonth }: {
  periods: ReconciliationPeriod[];
  initialYear: number;
  initialMonth: number;
}) {
  const [year, setYear] = useState(initialYear);
  const [month, setMonth] = useState(initialMonth);
  const years = [...new Set(periods.map(period => period.year))].sort((a, b) => b - a);
  const months = periods.filter(period => period.year === year).map(period => period.month).sort((a, b) => a - b);
  return <form action="/reconciliation" method="get" className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
    <label className="space-y-2 text-sm text-zinc-300"><span className="block">Month</span>
      <select name="month" value={month} onChange={event => setMonth(Number(event.target.value))} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
        {months.map(value => <option key={value} value={value}>{monthNames[value - 1]}</option>)}
      </select>
    </label>
    <label className="space-y-2 text-sm text-zinc-300"><span className="block">Year</span>
      <select name="year" value={year} onChange={event => {
        const value = Number(event.target.value);
        const availableMonths = periods.filter(period => period.year === value).map(period => period.month).sort((a, b) => a - b);
        setYear(value);
        if (!availableMonths.includes(month)) setMonth(availableMonths[0]);
      }} className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">
        {years.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
    </label>
    <button type="submit" name="run" value="1" className="rounded-md bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">Reconcile</button>
  </form>;
}
