import { getSavedUnsettledYear, loadReconciliationMonth } from '@/lib/reconciliation-cache';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
function validYear(year: unknown): year is number {
  const current = Number(new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Singapore' }).format(new Date()));
  return Number.isInteger(year) && Number(year) >= 2026 && Number(year) <= current;
}
export async function GET(request: Request) {
  const year = Number(new URL(request.url).searchParams.get('year'));
  if (!validYear(year)) return Response.json({ error: 'Choose an available year.' }, { status: 400 });
  try { return Response.json(await getSavedUnsettledYear(year), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Saved results could not be loaded. Try again.' }, { status: 502 }); }
}
export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Open Unsettled in Studio Ops.' }, { status: 403 });
  try {
    const body = await request.json();
    if (!validYear(body.year)) return Response.json({ error: 'Choose an available year.' }, { status: 400 });
    const state = await getSavedUnsettledYear(body.year);
    if (body.month !== undefined) {
      if (!state.months.includes(body.month)) return Response.json({ error: 'Choose an elapsed month.' }, { status: 400 });
      return Response.json(await loadReconciliationMonth(body.year, body.month, body.force === true));
    }
    return Response.json(state);
  } catch (error) {
    console.error('Saved unsettled check failed', error);
    return Response.json({ error: 'This month could not finish. Retry; completed months are saved.' }, { status: 502 });
  }
}
