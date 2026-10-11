import { getBankHistory, backfillBankMonth } from "@/lib/bank-reconciliation-history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function period(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("Choose a month and year.");
  const { year, month } = value as { year: number; month: number };
  const current = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit" }).format(new Date()).split('-');
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2026 || month < 1 || month > 12 ||
    year * 12 + month > Number(current[0]) * 12 + Number(current[1])) throw new Error("Choose a month from January 2026 through the current month.");
  return { year, month };
}

export async function GET(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    const { year, month } = period({ year: Number(query.get('year')), month: Number(query.get('month')) });
    return Response.json(await getBankHistory(year, month), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: "History could not be loaded. Check the selected period and database connection." }, { status: 400 }); }
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: "Open the history check in Studio Ops." }, { status: 403 });
  try {
    const { year, month } = period(await request.json());
    return Response.json(await backfillBankMonth(year, month));
  } catch (error) {
    console.error('History reconciliation failed:', error);
    return Response.json({ error: "This month could not finish. Retry it; saved confirmations will not be counted twice." }, { status: 502 });
  }
}
