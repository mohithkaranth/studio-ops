'use client';
import { useState } from 'react';

export type StatementAllocation = { appointmentId: string; cents: number; method: string };
export default function BankAllocationEditor({ transactionId, allocations, remainingCents, onChange }: {
  transactionId: string; allocations: StatementAllocation[]; remainingCents: number; onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const money = (cents: number) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(cents / 100);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await change('POST', String(data.get('appointmentId')), String(data.get('amount')));
  }
  async function change(method: string, appointmentId: string, amount?: string) {
    setBusy(true); setMessage('Saving…');
    try {
      const response = await fetch('/api/reconciliation/allocations', { method,
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transactionId, appointmentId, amount }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      await onChange();
      setMessage(method === 'DELETE' ? 'Allocation released. Its amount is available again.' : 'Confirmation saved. Other months will exclude this allocated amount.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to save.'); }
    finally { setBusy(false); }
  }
  return <details className="mt-2 min-w-56 text-xs">
    <summary className="cursor-pointer text-zinc-300 underline">Review / confirm payment</summary>
    <div className="mt-3 space-y-3">
      <p>Unallocated: {money(remainingCents)}</p>
      {allocations.map(item => <div key={item.appointmentId} className="flex flex-wrap items-center gap-2">
        <span>Booking #{item.appointmentId}: {money(item.cents)} ({item.method === 'manual' ? 'Manual' : 'Booking reference'})</span>
        <button type="button" disabled={busy} onClick={() => change('DELETE', item.appointmentId)} className="rounded border border-zinc-600 px-2 py-1 disabled:opacity-50">Undo allocation</button>
      </div>)}
      <form onSubmit={save} className="space-y-2">
        <label className="block">Acuity booking ID<input required name="appointmentId" inputMode="numeric" pattern="[0-9]+" disabled={busy} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 p-2" /></label>
        <label className="block">Amount allocated (SGD)<input required name="amount" type="number" step="0.01" min="0.01" disabled={busy} className="mt-1 block w-full rounded border border-zinc-700 bg-zinc-900 p-2" /></label>
        <p>Confirm only after checking that this transfer paid for the booking. Entering the same booking again replaces its saved amount.</p>
        <button disabled={busy} className="rounded bg-zinc-200 px-3 py-2 font-semibold text-zinc-950 disabled:opacity-50">Confirm allocation</button>
      </form>
      <p role="status">{message}</p>
    </div>
  </details>;
}
