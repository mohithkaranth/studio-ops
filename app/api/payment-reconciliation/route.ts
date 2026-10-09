import { sql } from '@/lib/db';
import { fetchAppointmentPayments, PaymentLookupError } from '@/lib/acuity/payments';
import { validDate, type Booking, type BankCredit } from '@/lib/payment-reconciliation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const id = params.get('appointmentId');
    if (id !== null) {
      if (!/^\d+$/.test(id)) return Response.json({ error: 'Invalid appointment ID.' }, { status: 400, headers });
      const bookings = await sql`select acuity_appointment_id from acuity_appointments where acuity_appointment_id = ${id} limit 1`;
      if (!bookings.length) return Response.json({ error: 'Booking not found. Sync Acuity first.' }, { status: 404, headers });
      return Response.json({ payments: await fetchAppointmentPayments(id) }, { headers });
    }
    const from = params.get('from') ?? '';
    const to = params.get('to') ?? '';
    if (!validDate(from) || !validDate(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) {
      return Response.json({ error: 'Choose a valid booking date range of up to 31 days.' }, { status: 400, headers });
    }
    const bookings = await sql<Booking[]>`
      select acuity_appointment_id::text as id,
        trim(concat_ws(' ', client_first_name, client_last_name)) as name,
        appointment_datetime::date::text as date, created_datetime::date::text as "createdDate",
        price::text as price, certificate_code as "certificateCode", canceled
      from acuity_appointments
      where appointment_datetime::date between ${from}::date and ${to}::date
      order by appointment_datetime, acuity_appointment_id limit 501
    `;
    if (bookings.length > 500) return Response.json({ error: 'More than 500 bookings. Choose a shorter range.' }, { status: 400, headers });
    const earliest = bookings.reduce((day, booking) => booking.createdDate && booking.createdDate < day ? booking.createdDate : day,
      new Date(Date.parse(from) - 30 * 86400000).toISOString().slice(0, 10));
    const credits = await sql<BankCredit[]>`
      select t.id::text as id, t.transaction_date::date::text as date,
        concat_ws(' ', t.description_1, t.description_2) as description,
        t.credit::text as amount, coalesce(u.currency, '') as currency
      from bank_transactions t join bank_statement_uploads u on u.id = t.upload_id
      where t.credit > 0 and coalesce(t.debit, 0) = 0
        and t.transaction_date between ${earliest}::date and (${to}::date + 7)
      order by t.transaction_date, t.id limit 10001
    `;
    if (credits.length > 10000) return Response.json({ error: 'Too many bank credits. Choose a shorter range.' }, { status: 400, headers });
    return Response.json({ bookings, credits }, { headers });
  } catch (error) {
    console.error('Payment reconciliation lookup failed:', error);
    return Response.json({ error: error instanceof PaymentLookupError
      ? error.message : 'Unable to load reconciliation data. Check the database connection and sync Acuity.' }, { status: 502, headers });
  }
}
