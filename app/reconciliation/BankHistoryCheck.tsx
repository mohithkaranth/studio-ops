'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { HistoryMonth } from '@/lib/bank-reconciliation-history';

export default function BankHistoryCheck({ year, month }: { year: number; month: number }) {
  const router = useRouter();
  const [months, setMonths] = useState<HistoryMonth[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [allocated, setAllocated] = useState<number | null>(null);
  async function run() {
    setBusy(true); setMessage('Loading saved history…');
    try {
      const response = await fetch(`/api/reconciliation/history?year=${year}&month=${month}`, { cache: 'no-store' });
      const history = await response.json();
      if (!response.ok) throw new Error(history.error);
      const progress: HistoryMonth[] = history.months;
      setMonths([...progress]);
      for (let index = 0; index < progress.length; index++) {
        const item = progress[index];
        if (item.status === 'complete') continue;
        setMessage(`Checking ${item.year}-${String(item.month).padStart(2, '0')}…`);
        progress[index] = { ...item, status: 'running' }; setMonths([...progress]);
        const checked = await fetch('/api/reconciliation/history', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year: item.year, month: item.month }) });
        const result = await checked.json();
        if (!checked.ok) {
          progress[index] = { ...item, status: 'failed', message: result.error }; setMonths([...progress]);
          throw new Error(result.error);
        }
        progress[index] = result; setMonths([...progress]);
      }
      const latestResponse = await fetch(`/api/reconciliation/history?year=${year}&month=${month}`, { cache: 'no-store' });
      const latest = await latestResponse.json();
      if (!latestResponse.ok) throw new Error(latest.error);
      setAllocated(latest.matchedCredits + latest.allocatedCredits);
      setMessage(latest.complete ? 'History check complete. PayNow matched payments are accounted for across all months.'
        : 'History check finished with incomplete months. Retry these months before treating the unaccounted total as final.');
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'History check failed. Retry to resume.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
    <h2 className="font-medium">Saved PayNow history</h2>
    <p className="text-sm text-zinc-400">Check January 2026 through the selected month. PayNow matched payments are treated as accounted for and excluded from No settlement totals. Keep this page open while it checks each month.</p>
    <button onClick={run} disabled={busy} className="rounded border border-zinc-600 px-4 py-2 text-sm text-zinc-100 disabled:opacity-50">{busy ? 'Checking history…' : 'Check / resume PayNow history'}</button>
    <p role="status" aria-live="polite" className="text-sm text-zinc-300">{message}{allocated !== null ? ` ${allocated} matched or allocated bank credits are accounted for.` : ''}</p>
    {months.length > 0 ? <ul className="space-y-1 text-sm text-zinc-400">{months.map(item => <li key={`${item.year}-${item.month}`}>
      {item.year}-{String(item.month).padStart(2, '0')} · {item.status} · {item.message ?? `${item.confirmedCredits} saved credits`}
    </li>)}</ul> : null}
  </section>;
}
