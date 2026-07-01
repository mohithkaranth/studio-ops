import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type ChatRequest = { question?: unknown };
type IntentKind =
  | "bank_credits"
  | "bank_debits"
  | "acuity_booking_count"
  | "acuity_booking_by_room_type"
  | "monthly_summary";
type DateRange =
  | { type: "explicit"; start: string; end: string }
  | { type: "last_months"; months: number }
  | { type: "month"; month: number; year: number };
type Intent = {
  type: "intent";
  intent: IntentKind;
  mode?: "total" | "list" | "both";
  searchText?: string | null;
  dateRange?: DateRange | null;
  groupBy?: "calendar_name" | "month" | null;
  includeAcuityValue?: boolean;
  revenueMetric?: "bank_revenue" | "acuity_value" | "both" | null;
};
type Clarification = { type: "clarification"; question: string; options?: string[] };
type ModelOutput = Intent | Clarification;
type QueryResult = { answer: string; columns: string[]; rows: Record<string, unknown>[] };

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const MAX_ROWS = 100;

const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return Response.json({ type: "clarification", question: "What would you like to ask about Studio Ops data?" });
    }

    const intent = await getIntent(question);

    if (intent.type === "clarification") return Response.json(intent);

    const validation = validateIntent(intent);
    if (validation) return Response.json(validation);

    const result = await runApprovedQuery(intent);
    return Response.json({ type: "answer", ...result });
  } catch (error) {
    console.error("Studio Chat failed:", error);
    return Response.json({ error: "Studio Chat could not answer that question." }, { status: 500 });
  }
}

async function getIntent(question: string): Promise<ModelOutput> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [
        { role: "system", content: STUDIO_CHAT_SYSTEM_PROMPT },
        { role: "user", content: question },
      ],
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
  const data = await response.json();
  const text = extractResponseText(data);
  if (!text) throw new Error("OpenAI returned no JSON text");
  return JSON.parse(text) as ModelOutput;
}

function extractResponseText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  if ("output_text" in data && typeof data.output_text === "string") return data.output_text;

  const output = "output" in data && Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object" || !("content" in item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && typeof content === "object" && "text" in content && typeof content.text === "string") return content.text;
    }
  }
  return null;
}

const STUDIO_CHAT_SYSTEM_PROMPT = `You convert Studio Ops questions into JSON intent only. Never write SQL.
Allowed data sources and fields:
- bank_transactions: transaction_date, description_1, description_2, debit, credit.
- acuity_appointments: appointment_datetime, calendar_name, canceled, price.
Definitions: bookings are count of non-cancelled Acuity appointments by appointment_datetime; room type is calendar_name; bank revenue is sum of credits; bank expenses are sum of debits; Acuity appointment value is sum of price; payments from a person/source are bank credits where description_1 or description_2 contains the search text.
Supported intents: bank_credits, bank_debits, acuity_booking_count, acuity_booking_by_room_type, monthly_summary.
Return one JSON object. If ambiguous, return {"type":"clarification","question":"...","options":["..."]}. For revenue ambiguity ask whether bank revenue, Acuity appointment value, or both. If a month is given without a year, ask which year. If bookings is used, default to acuity booking count. If room type is used, group by calendar_name.
Intent shape: {"type":"intent","intent":"bank_credits|bank_debits|acuity_booking_count|acuity_booking_by_room_type|monthly_summary","mode":"total|list|both","searchText":string|null,"dateRange":{"type":"explicit","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}|{"type":"last_months","months":number}|{"type":"month","month":1-12,"year":number}|null,"groupBy":"calendar_name|month"|null,"includeAcuityValue":boolean,"revenueMetric":"bank_revenue|acuity_value|both"|null}`;

function validateIntent(intent: Intent): Clarification | null {
  const allowed = new Set<IntentKind>(["bank_credits", "bank_debits", "acuity_booking_count", "acuity_booking_by_room_type", "monthly_summary"]);
  if (intent.type !== "intent" || !allowed.has(intent.intent)) {
    return { type: "clarification", question: "I can answer bank credit/debit, booking count, room type, and monthly summary questions. Which one do you want?" };
  }
  if (intent.dateRange) {
    if (intent.dateRange.type === "last_months" && (!Number.isInteger(intent.dateRange.months) || intent.dateRange.months < 1 || intent.dateRange.months > 60)) {
      return { type: "clarification", question: "How many recent months should I include?" };
    }
    if (intent.dateRange.type === "month" && (!Number.isInteger(intent.dateRange.month) || intent.dateRange.month < 1 || intent.dateRange.month > 12 || !Number.isInteger(intent.dateRange.year))) {
      return { type: "clarification", question: "Which month and year should I use?" };
    }
    if (intent.dateRange.type === "explicit" && (!isIsoDate(intent.dateRange.start) || !isIsoDate(intent.dateRange.end))) {
      return { type: "clarification", question: "What exact date range should I use?" };
    }
  }
  if (intent.intent === "monthly_summary" && !intent.revenueMetric) {
    return { type: "clarification", question: "For revenue, do you mean bank revenue, Acuity appointment value, or both?", options: ["Bank revenue", "Acuity appointment value", "Both"] };
  }
  return null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getDateSql(range: DateRange | null | undefined, column: ReturnType<typeof sql>) {
  if (!range) return sql``;
  if (range.type === "last_months") return sql`and ${column} >= date_trunc('month', current_date) - (${range.months - 1} * interval '1 month') and ${column} < current_date + interval '1 day'`;
  if (range.type === "month") return sql`and ${column} >= make_date(${range.year}, ${range.month}, 1) and ${column} < make_date(${range.year}, ${range.month}, 1) + interval '1 month'`;
  return sql`and ${column} >= ${range.start}::date and ${column} < ${range.end}::date + interval '1 day'`;
}

function dateLabel(range?: DateRange | null) {
  if (!range) return "all time";
  if (range.type === "last_months") return `the past ${range.months} month${range.months === 1 ? "" : "s"}`;
  if (range.type === "month") return `${range.year}-${String(range.month).padStart(2, "0")}`;
  return `${range.start} to ${range.end}`;
}

async function runApprovedQuery(intent: Intent): Promise<QueryResult> {
  switch (intent.intent) {
    case "bank_credits": return runBank(intent, "credit");
    case "bank_debits": return runBank(intent, "debit");
    case "acuity_booking_count": return runBookingCount(intent);
    case "acuity_booking_by_room_type": return runBookingsByRoom(intent);
    case "monthly_summary": return runMonthlySummary(intent);
  }
}

async function runBank(intent: Intent, kind: "credit" | "debit"): Promise<QueryResult> {
  const dateFilter = getDateSql(intent.dateRange, sql`transaction_date`);
  const search = intent.searchText?.trim();
  const rows = await sql<Record<string, unknown>[]>`
    select transaction_date::text, description_1, description_2, ${kind === "credit" ? sql`credit::text as credit` : sql`debit::text as debit`}
    from bank_transactions
    where ${kind === "credit" ? sql`credit` : sql`debit`} > 0
      ${dateFilter}
      ${search ? sql`and (description_1 ilike ${`%${search}%`} or description_2 ilike ${`%${search}%`})` : sql``}
    order by transaction_date desc
    limit ${MAX_ROWS}
  `;
  const totals = await sql<{ total: string | null; count: number }[]>`
    select coalesce(sum(${kind === "credit" ? sql`credit` : sql`debit`}), 0)::text as total, count(*)::int as count
    from bank_transactions
    where ${kind === "credit" ? sql`credit` : sql`debit`} > 0
      ${dateFilter}
      ${search ? sql`and (description_1 ilike ${`%${search}%`} or description_2 ilike ${`%${search}%`})` : sql``}
  `;
  const total = Number(totals[0]?.total ?? 0);
  const label = kind === "credit" ? "credits" : "debits";
  return { answer: `I found ${totals[0]?.count ?? 0} bank ${label}${search ? ` matching “${search}”` : ""} for ${dateLabel(intent.dateRange)}, totaling ${money.format(total)}.`, columns: ["transaction_date", "description_1", "description_2", kind], rows };
}

async function runBookingCount(intent: Intent): Promise<QueryResult> {
  const dateFilter = getDateSql(intent.dateRange, sql`appointment_datetime`);
  const rows = await sql<Record<string, unknown>[]>`
    select count(*)::int as booking_count
    from acuity_appointments
    where appointment_datetime is not null and coalesce(canceled, false) is false
      ${dateFilter}
  `;
  return { answer: `I found ${rows[0]?.booking_count ?? 0} non-cancelled bookings for ${dateLabel(intent.dateRange)}.`, columns: ["booking_count"], rows };
}

async function runBookingsByRoom(intent: Intent): Promise<QueryResult> {
  const dateFilter = getDateSql(intent.dateRange, sql`appointment_datetime`);
  const rows = await sql<Record<string, unknown>[]>`
    select coalesce(nullif(calendar_name, ''), 'Unknown room type') as calendar_name, count(*)::int as booking_count
    from acuity_appointments
    where appointment_datetime is not null and coalesce(canceled, false) is false
      ${dateFilter}
    group by 1 order by booking_count desc, calendar_name asc
  `;
  return { answer: `I found ${rows.reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0)} non-cancelled bookings by room type for ${dateLabel(intent.dateRange)}.`, columns: ["calendar_name", "booking_count"], rows };
}

async function runMonthlySummary(intent: Intent): Promise<QueryResult> {
  const bankDateFilter = getDateSql(intent.dateRange, sql`transaction_date`);
  const acuityDateFilter = getDateSql(intent.dateRange, sql`appointment_datetime`);
  const rows = await sql<Record<string, unknown>[]>`
    with bank as (
      select date_trunc('month', transaction_date)::date as month_start, sum(coalesce(credit, 0)) as bank_revenue, sum(coalesce(debit, 0)) as bank_expenses
      from bank_transactions where transaction_date is not null ${bankDateFilter} group by 1
    ), acuity as (
      select date_trunc('month', appointment_datetime)::date as month_start, count(*)::int as booking_count, sum(coalesce(price, 0)) as acuity_appointment_value
      from acuity_appointments where appointment_datetime is not null and coalesce(canceled, false) is false ${acuityDateFilter} group by 1
    )
    select coalesce(bank.month_start, acuity.month_start)::text as month_start,
      coalesce(acuity.booking_count, 0)::int as booking_count,
      coalesce(bank.bank_revenue, 0)::text as bank_revenue,
      coalesce(bank.bank_expenses, 0)::text as bank_expenses,
      (coalesce(bank.bank_revenue, 0) - coalesce(bank.bank_expenses, 0))::text as net_movement,
      coalesce(acuity.acuity_appointment_value, 0)::text as acuity_appointment_value
    from bank full join acuity on acuity.month_start = bank.month_start
    order by coalesce(bank.month_start, acuity.month_start) asc
  `;
  const totalBookings = rows.reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0);
  return { answer: `I found ${rows.length} monthly summary row${rows.length === 1 ? "" : "s"} for ${dateLabel(intent.dateRange)}, covering ${totalBookings} non-cancelled bookings.`, columns: ["month_start", "booking_count", "bank_revenue", "bank_expenses", "net_movement", "acuity_appointment_value"], rows };
}
