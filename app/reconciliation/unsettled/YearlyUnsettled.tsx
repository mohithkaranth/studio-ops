'use client';

import { useState } from 'react';
import Link from 'next/link';
import ReconciliationTable from '../ReconciliationTable';
import type { ReconciliationRow } from '@/lib/stripe/reconciliation';
import { displayReconciliationStatus } from '@/lib/reconciliation-status';
import type { getUnsettledTotals } from '@/lib/unsettled-totals-data';

const money = (cents: number) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(cents / 100);
type Totals = Awaited<ReturnType<typeof getUnsettledTotals>>;

export default function YearlyUnsettled({ years, periods, currentYear, currentMonth, initialYear }: {
  years: number[]; periods: { year: number; month: number }[]; currentYear: number; currentMonth: number; initialYear: number;
}) {
  const [year, setYear] = useState(initialYear);
  const [rows, setRows] = useState<ReconciliationRow[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [unchecked, setUnchecked] = useState(0);

  async function request(body: object) {
    const response = await fetch('/api/reconciliation/unsettled', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Unable to check this year.');
    return result;
  }

  async function check() {
    setBusy(true); setTotals(null); setRows([]); setError(''); setUnchecked(0);
    const allRows: ReconciliationRow[] = [];
    const months = periods.filter(period => period.year === year && (year < currentYear || period.month <= currentMonth)).map(period => period.month).sort((a, b) => a - b);
    try {
      for (const [index, month] of months.entries()) {
        setProgress(`Checking ${new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))} · ${index + 1} of ${months.length} months`);
        const result = await request({ year, month });
        allRows.push(...result.rows);
      }
      const unsettled = allRows.filter(row => displayReconciliationStatus(row) === 'No settlement');
      setProgress('Comparing yearly totals and excluding accounted payments…');
      const result = await request({ year, checkedMonths: months, appointmentIds: unsettled.map(row => row.appointmentId) });
      setRows(unsettled); setTotals(result);
      setUnchecked(allRows.filter(row => displayReconciliationStatus(row) === 'Unable to check').length);
      setProgress(`${year === currentYear ? 'Year to date' : 'Full year'} checked · ${months.length} months`);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Unable to finish checking.'); setProgress('');
    } finally { setBusy(false); }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <label htmlFor="unsettled-year">Year</label>
      <select id="unsettled-year" disabled={busy} value={year} onChange={event => { setYear(Number(event.target.value)); setTotals(null); setRows([]); setProgress(''); setError(''); }} className="rounded border border-zinc-700 bg-zinc-900 p-2">
        {years.map(value => <option key={value}>{value}</option>)}
      </select>
      <button disabled={busy || !years.length} onClick={check} className="rounded bg-zinc-100 px-4 py-2 text-zinc-950 disabled:opacity-50">{busy ? 'Checking…' : 'Check yearly unsettled'}</button>
      <p role="status" className="text-sm text-zinc-400">{progress}</p>
    </div>
    <p className="text-sm text-zinc-400">For the current year, only sessions that have already taken place are included. Each payment must fall between a listed booking’s creation date and session date. Payments already accounted for in any month, plus IRAS and Mohith Karanth credits, are excluded. The comparison is by totals; it does not assign payments to individual bookings.</p>
    {error ? <p role="alert" className="text-red-300">{error}</p> : null}
    {totals ? <>
      <section className="grid gap-4 sm:grid-cols-3">
        {[
          ['Unsettled bookings', String(rows.length)],
          ['Total Acuity cost', totals.acuityCostCents === null ? 'Unavailable' : money(totals.acuityCostCents)],
          ['Unaccounted PayNow credits', money(totals.payNowCents)],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>)}
      </section>
      <p className="text-sm text-zinc-400">Acuity cost is the sum of the bookings below. {totals.creditCount} separate PayNow credits are included, each counted once. {totals.acuityCostCents !== null ? `Difference (Acuity less PayNow): ${money(totals.acuityCostCents - totals.payNowCents)}.` : ''}</p>
      {unchecked ? <p role="alert" className="text-amber-300">{unchecked} booking(s) could not be fully checked and are excluded. Resolve these in monthly reconciliation before treating this comparison as final.</p> : null}
      {totals.missingWindows ? <p role="alert" className="text-amber-300">{totals.missingWindows} booking(s) have missing or invalid dates; their payment windows could not be included.</p> : null}
      <ReconciliationTable rows={rows} title={`${year} unsettled Acuity bookings`} emptyMessage="No unsettled bookings in this year." />
      <section className="overflow-hidden rounded-xl border border-zinc-800">
        <h2 className="border-b border-zinc-800 p-4 text-lg">Included unaccounted PayNow payments</h2>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Date', 'Bank description / payer', 'Unaccounted amount', 'Payment'].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>{totals.credits.map(credit => <tr key={credit.id} className="border-t border-zinc-800"><td className="whitespace-nowrap p-3">{credit.date}</td><td className="p-3 text-zinc-400">{credit.description}</td><td className="p-3">{money(credit.cents)}</td><td className="whitespace-nowrap p-3"><Link className="underline" href={`/bank-statements?uploadId=${credit.uploadId}#payment-${credit.transactionId}`}>View PayNow payment</Link></td></tr>)}</tbody>
        </table></div>
        {!totals.credits.length ? <p className="p-4 text-zinc-400">No unaccounted PayNow credits within these booking windows.</p> : null}
      </section>
    </> : null}
  </div>;
}
