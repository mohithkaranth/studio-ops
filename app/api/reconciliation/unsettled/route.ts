import { reconcileStripeBookings } from "@/lib/stripe/reconciliation";
import { getUnsettledTotals } from "@/lib/unsettled-totals-data";
import { getReconciliationPeriods } from "@/lib/reconciliation-period-data";
import { sql } from "@/lib/db";
import { sgdCents } from "@/lib/stripe/reconciliation-model";

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Open Unsettled in Studio Ops.' }, { status: 403 });
  try {
    const body = await request.json();
    const year = body.year;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    if (!Number.isInteger(year) || year < 2026 || year > Number(today.slice(0, 4))) return Response.json({ error: 'Choose an available year.' }, { status: 400 });
    if (body.month !== undefined) {
      const month = body.month;
      if (!Number.isInteger(month) || month < 1 || month > 12 || (year === Number(today.slice(0, 4)) && month > Number(today.slice(5, 7)))) return Response.json({ error: 'Choose an elapsed month.' }, { status: 400 });
      const rows = await reconcileStripeBookings(year, month);
      return Response.json({ rows: rows.filter(row => new Date(row.appointmentDate).getTime() <= Date.now()) });
    }
    const ids = body.appointmentIds;
    if (!Array.isArray(ids) || ids.length > 20000 || ids.some(id => typeof id !== 'string' || !/^\d+$/.test(id))) return Response.json({ error: 'Check the yearly bookings again.' }, { status: 400 });
    const periods = await getReconciliationPeriods();
    const expectedMonths = periods.filter(period => period.year === year && (year < Number(today.slice(0, 4)) || period.month <= Number(today.slice(5, 7)))).map(period => period.month);
    if (!Array.isArray(body.checkedMonths) || expectedMonths.some(month => !body.checkedMonths.includes(month))) return Response.json({ error: 'Finish checking every available month before comparing totals.' }, { status: 400 });
    const bookings = ids.length ? await sql<{ price: string | null; createdDate: string | null; appointmentDate: string }[]>`
      SELECT price, created_datetime AS "createdDate", appointment_datetime AS "appointmentDate"
      FROM acuity_appointments WHERE acuity_appointment_id::text IN ${sql([...new Set<string>(ids)])}
      AND appointment_datetime >= ${`${year}-01-01T00:00:00+08:00`}::timestamptz
      AND appointment_datetime < ${`${year + 1}-01-01T00:00:00+08:00`}::timestamptz
      AND appointment_datetime <= now() AND coalesce(canceled, false) = false AND coalesce(certificate_code, '') = ''
    ` : [];
    if (bookings.length !== new Set(ids).size) return Response.json({ error: 'Bookings changed. Check the year again.' }, { status: 409 });
    return Response.json(await getUnsettledTotals(bookings.map(booking => ({ ...booking, costCents: sgdCents(booking.price) }))));
  } catch (error) {
    console.error('Yearly unsettled check failed', error);
    return Response.json({ error: 'This check could not finish. Retry; no payment will be counted twice.' }, { status: 502 });
  }
}
