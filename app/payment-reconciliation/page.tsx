'use client';

import { useState } from 'react';
import { suggestPayNow, type Booking, type BankCredit, type PaymentEvidence, type ProcessorPayment } from '@/lib/payment-reconciliation';

const money = (cents: number) => new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' }).format(cents / 100);

export default function PaymentReconciliationPage() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [credits, setCredits] = useState<BankCredit[]>([]);
  const [evidence, setEvidence] = useState<Record<string, PaymentEvidence>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const rows = suggestPayNow(bookings, credits, evidence);

  async function load(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setBusy(true); setLoaded(false); setBookings([]); setCredits([]); setEvidence({}); setErrors({});
    setMessage('Loading bookings and bank credits…');
    try {
      const query = new URLSearchParams({ from: String(values.get('from')), to: String(values.get('to')) });
      const response = await fetch(`/api/payment-reconciliation?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to load bookings.');
      setBookings(data.bookings); setCredits(data.credits); setLoaded(true);
      setMessage(`${data.bookings.length} bookings loaded. Check processor payments to see PayNow suggestions.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to load bookings.'); }
    finally { setBusy(false); }
  }

  async function checkPayments() {
    setBusy(true);
    let next = 0; let completed = 0; let failed = 0;
    const pending = bookings.filter((booking) => evidence[booking.id]?.status !== 'loaded');
    try {
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (next < pending.length) {
          const booking = pending[next++];
          try {
            const response = await fetch(`/api/payment-reconciliation?appointmentId=${encodeURIComponent(booking.id)}`, { cache: 'no-store' });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error ?? 'Payment lookup failed.');
            setEvidence((current) => ({ ...current, [booking.id]: { status: 'loaded', payments: data.payments as ProcessorPayment[] } }));
            setErrors((current) => { const updated = { ...current }; delete updated[booking.id]; return updated; });
          } catch (error) {
            failed++;
            setEvidence((current) => ({ ...current, [booking.id]: { status: 'error', payments: [] } }));
            setErrors((current) => ({ ...current, [booking.id]: error instanceof Error ? error.message : 'Payment lookup failed.' }));
          }
          completed++;
          setMessage(`Checked ${completed} of ${pending.length} bookings${failed ? `; ${failed} lookups failed` : ''}.`);
        }
      }));
    } finally { setBusy(false); }
  }

  return <main className="mx-auto w-full max-w-7xl space-y-6 px-6 py-12 text-zinc-100">
    <header className="space-y-2">
      <h1 className="text-3xl font-semibold">Payment Reconciliation</h1>
      <p className="text-sm text-zinc-300">Review Acuity processor records and possible PayNow payments for your bookings.</p>
      <p className="text-sm text-zinc-400">This preview does not mark bookings paid. Processor records come from Acuity; PayNow suggestions require review. Stripe bank payouts are excluded from PayNow suggestions.</p>
    </header>
    <form onSubmit={load} className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-700 bg-zinc-950 p-5">
      <label className="space-y-1 text-sm">Booking date from<input required disabled={busy} type="date" name="from" className="block rounded border border-zinc-700 bg-zinc-900 p-2" /></label>
      <label className="space-y-1 text-sm">Booking date to<input required disabled={busy} type="date" name="to" className="block rounded border border-zinc-700 bg-zinc-900 p-2" /></label>
      <button disabled={busy} className="rounded bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">Load bookings</button>
      <span className="text-sm text-zinc-400">Up to 31 days</span>
    </form>
    {loaded && bookings.length > 0 && <button onClick={checkPayments} disabled={busy || bookings.every((booking) => evidence[booking.id]?.status === 'loaded')} className="rounded border border-zinc-600 px-4 py-2 text-sm disabled:opacity-50">{busy ? 'Checking…' : 'Check processor payments / retry failures'}</button>}
    <p role="status" aria-live="polite" className="text-sm text-zinc-300">{message}</p>
    <p className="text-sm text-zinc-400">PayNow suggestions require the outstanding recorded amount plus a booking reference or full customer name. Package redemptions and canceled bookings need separate review. Only uploaded statements are searched; absence of a match does not prove non-payment.</p>
    {loaded && <div className="overflow-x-auto rounded-xl border border-zinc-700">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-zinc-900 text-zinc-300"><tr>{['Booking', 'Price', 'Processor records', 'Recorded balance', 'PayNow review'].map((title) => <th key={title} className="px-4 py-3">{title}</th>)}</tr></thead>
        <tbody className="divide-y divide-zinc-800">
          {!rows.length && <tr><td colSpan={5} className="p-5">No bookings in this range. Sync Acuity or choose another range.</td></tr>}
          {rows.map(({ booking, processorCents, remainingCents, candidates, sharedCredit, hasAdjustments }) => <tr key={booking.id}>
            <td className="px-4 py-4"><p>{booking.name || 'Unnamed customer'}</p><p className="text-zinc-400">#{booking.id} · {booking.date}</p>{booking.canceled && <p className="text-amber-300">Canceled</p>}{booking.certificateCode && <p className="text-amber-300">Certificate / package</p>}</td>
            <td className="px-4 py-4">{booking.price ?? 'Unknown'}</td>
            <td className="px-4 py-4">{evidence[booking.id]?.status === 'loaded' ? <>
              <p>{processorCents === null ? 'Invalid amounts — review' : money(processorCents)}</p>
              {evidence[booking.id].payments.map((payment) => <p key={`${payment.processor}:${payment.transactionID}`} className="mt-1 break-all text-xs text-zinc-400">{payment.processor} · {payment.transactionID} · {payment.amount}{payment.created ? ` · ${payment.created}` : ''}</p>)}
              {!evidence[booking.id].payments.length && <p className="text-zinc-400">No processor records in Acuity</p>}
            </> : <p className={errors[booking.id] ? 'text-amber-300' : 'text-zinc-400'}>{errors[booking.id] ?? 'Not checked'}</p>}</td>
            <td className="px-4 py-4">{remainingCents === null ? 'Unknown' : money(remainingCents)}{remainingCents !== null && remainingCents < 0 && <p className="text-amber-300">Overpayment / adjustment — review</p>}</td>
            <td className="px-4 py-4">{booking.canceled || booking.certificateCode || hasAdjustments ? 'Separate review required' : processorCents === null ? 'Check processor records first' : candidates.length ? <>
              <p className="text-amber-300">{sharedCredit || candidates.length > 1 ? 'Ambiguous — review' : 'Possible match — review'}</p>
              {candidates.map((credit) => <p key={credit.id} className="mt-2 max-w-sm text-xs text-zinc-300">{credit.date} · {credit.amount} SGD · bank #{credit.id}<br />{credit.description}</p>)}
            </> : remainingCents !== null && remainingCents <= 0 ? 'No additional payment suggested' : 'No PayNow candidate found'}</td>
          </tr>)}
        </tbody>
      </table>
    </div>}
  </main>;
}
