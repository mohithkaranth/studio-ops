import 'server-only';
import type { ProcessorPayment } from '@/lib/payment-reconciliation';
import { moneyToCents } from '@/lib/payment-reconciliation';

export class PaymentLookupError extends Error {}

export async function fetchAppointmentPayments(id: string): Promise<ProcessorPayment[]> {
  if (!/^\d+$/.test(id)) throw new Error('Invalid appointment ID.');
  const userId = process.env.ACUITY_USER_ID;
  const apiKey = process.env.ACUITY_API_KEY;
  if (!userId || !apiKey) throw new PaymentLookupError('Acuity credentials are not configured.');
  const response = await fetch(`https://acuityscheduling.com/api/v1/appointments/${id}/payments`, {
    headers: { Authorization: `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`, Accept: 'application/json' },
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new PaymentLookupError(`Acuity payment lookup failed (${response.status}). Try again later.`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error('Unexpected Acuity payment response.');
  const seen = new Set<string>();
  return payload.map((item: unknown) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid Acuity payment record.');
    const record = item as Record<string, unknown>;
    const amount = String(record.amount ?? '');
    if (moneyToCents(amount) === null || !record.transactionID || !record.processor) {
      throw new Error('Incomplete Acuity payment record.');
    }
    const key = `${record.processor}:${record.transactionID}`;
    if (seen.has(key)) throw new Error('Duplicate Acuity payment records require review.');
    seen.add(key);
    return { amount, transactionID: String(record.transactionID), processor: String(record.processor),
      created: typeof record.created === 'string' ? record.created : null };
  });
}
