import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

type ChatRequest = { question?: unknown };
type IntentKind =
  | "bank_credits"
  | "bank_debits"
  | "bank_movement_summary"
  | "acuity_booking_count"
  | "acuity_booking_by_room_type"
  | "monthly_summary";
type DateRange =
  | { type: "explicit"; start: string; end: string; label?: string }
  | { type: "last_months"; months: number; label?: string }
  | { type: "month"; month: number; year: number; label?: string };
type TransactionType = "credit" | "debit" | "both";
type MetricMode = "total" | "count" | "list" | "summary";
type ResultMode = "aggregate_only" | "rows_only" | "aggregate_with_rows";
type Intent = {
  type: "intent";
  intent: IntentKind;
  mode?: "total" | "list" | "both";
  transactionType?: TransactionType;
  metricMode?: MetricMode;
  resultMode?: ResultMode;
  rowLimit?: number;
  searchText?: string | null;
  dateRange?: DateRange | null;
  groupBy?: "calendar_name" | "month" | "month_calendar_name" | null;
  dateBasis?: "appointment_datetime" | "created_datetime" | null;
  includeAcuityValue?: boolean;
  revenueMetric?: "bank_revenue" | "acuity_value" | "both" | null;
};
type Clarification = { type: "clarification"; question: string; options?: string[] };
type ModelOutput = Intent | Clarification;
type QueryResult = { answer: string; columns: string[]; rows: Record<string, unknown>[] };
type IntentSource = "fast-path" | "openai";

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const DEFAULT_ROW_LIMIT = 50;
const MAX_ROW_LIMIT = 100;

const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const question = typeof body.question === "string" ? body.question.trim() : "";

    if (!question) {
      return Response.json({ type: "clarification", question: "What would you like to ask about Studio Ops data?" });
    }

    const { output: modelOutput, source } = await getIntent(question);
    const intent = normalizeModelOutput(modelOutput, question);

    if (intent.type === "clarification") {
      logStudioChat({ source, output: intent });
      return Response.json(intent);
    }

    const validation = validateIntent(intent, question);
    if (validation) {
      logStudioChat({ source, output: intent, clarification: validation });
      return Response.json(validation);
    }

    const result = await runApprovedQuery(intent);
    logStudioChat({ source, output: intent, rowCount: result.rows.length });
    return Response.json({ type: "answer", ...result });
  } catch (error) {
    console.error("Studio Chat failed:", error);
    return Response.json({ error: "Studio Chat could not answer that question." }, { status: 500 });
  }
}

async function getIntent(question: string): Promise<{ output: ModelOutput; source: IntentSource }> {
  const fastPath = parseFastPathIntent(question);
  if (fastPath) return { output: fastPath, source: "fast-path" };

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
  return { output: JSON.parse(text) as ModelOutput, source: "openai" };
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
- acuity_appointments: appointment_datetime, created_datetime, calendar_name, canceled, price.
Definitions: bank revenue is sum of bank credits; bank expenses are sum of bank debits; Acuity appointment value is sum of appointment price; bookings are count of non-cancelled Acuity appointments; room type is calendar_name; payments from a person/source are bank credits where description_1 or description_2 contains the search text.
Supported intents: bank_credits, bank_debits, bank_movement_summary, acuity_booking_count, acuity_booking_by_room_type, monthly_summary.
Return one JSON object. Never write SQL. Clarify only when a missing choice changes the result.
Distinguish date basis, grouping dimension, and metric source. "By appointment date" sets dateBasis to appointment_datetime, not groupBy. "By booking created date" sets dateBasis to created_datetime. "By calendar name" and "by room type" set groupBy to calendar_name. "By month" sets groupBy to month. If both month and calendar name/room are requested, set groupBy to month_calendar_name.
Revenue rules: if the user says bank revenue, use bank_revenue; if the user says Acuity revenue, Acuity appointment value, or appointment value, use acuity_value; if the user says both revenue types, use both. Ask revenue clarification only for unsourced "revenue".
Booking rules: default dateBasis to appointment_datetime. Clarify booking date basis only when the user asks to compare/group bookings by date but does not say appointment date or booking created date. Booking counts default to non-cancelled Acuity appointments.
Mixed monthly summaries: expenses are bank debits; bank revenue is bank credits; bookings are Acuity counts. If grouped by calendar_name/room type, grouping applies only to Acuity booking counts unless explicit reconciliation data exists; do not allocate bank revenue or expenses by calendar_name.
If a month is given without a year, ask which year. Treat year phrases like "in the year 2026", "for 2026", "during 2026", and "2026 total" as an explicit dateRange from 2026-01-01 to exclusive 2027-01-01. If users ask for total debit and credit / credits and debits / expenses and revenue, use bank_movement_summary with transactionType both, metricMode summary, resultMode aggregate_only so both sides and net movement are returned, not transaction rows.
Bank transaction intents must include transactionType (credit|debit|both), metricMode (total|count|list|summary), resultMode (aggregate_only|rows_only|aggregate_with_rows), rowLimit (default 50 for row outputs), searchText, and dateRange. Preserve named vendors/sources/people/references (for example Stripe, Grab, Muhammad, rent, PayNow, FAST PAYMENT) as searchText for bank credits/debits and payments from a person/source. Aggregate wording (how much, total, sum, summary, overall, amount) means aggregate_only. Row/detail wording (show all, list, details, transactions, show payments, tell me all payments) means aggregate_with_rows and must still include aggregate count and amount. Ask for clarification for unsourced "revenue".
Intent shape: {"type":"intent","intent":"bank_credits|bank_debits|bank_movement_summary|acuity_booking_count|acuity_booking_by_room_type|monthly_summary","mode":"total|list|both","transactionType":"credit|debit|both","metricMode":"total|count|list|summary","resultMode":"aggregate_only|rows_only|aggregate_with_rows","rowLimit":number,"searchText":string|null,"dateRange":{"type":"explicit","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}|{"type":"last_months","months":number}|{"type":"month","month":1-12,"year":number}|null,"groupBy":"calendar_name|month|month_calendar_name"|null,"dateBasis":"appointment_datetime|created_datetime"|null,"includeAcuityValue":boolean,"revenueMetric":"bank_revenue|acuity_value|both"|null}`;

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

function hasAggregateWording(question: string) {
  return /\b(how much|total|sum|summary|summar(?:y|ise|ize)|overall|amount)\b/i.test(question);
}

function hasRowWording(question: string) {
  return /\b(show all|list|details?|transactions?|show payments?|tell me all payments?)\b/i.test(question);
}

function hasDateWording(question: string) {
  return /\b(20\d{2}|this\s+(?:month|year)|last\s+month|past\s+\d{1,2}\s+months?|last\s+\d{1,2}\s+months?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i.test(question);
}

function resultShapeFromQuestion(question: string): { metricMode: MetricMode; resultMode: ResultMode; mode: "total" | "list" | "both" } {
  const aggregate = hasAggregateWording(question);
  const rows = hasRowWording(question);
  if (rows && !aggregate) return { metricMode: "list", resultMode: "aggregate_with_rows", mode: "list" };
  return { metricMode: "total", resultMode: "aggregate_only", mode: "total" };
}

function normalizeRowLimit(rowLimit: unknown, resultMode?: ResultMode) {
  if (resultMode === "aggregate_only") return 0;
  if (!Number.isInteger(rowLimit)) return DEFAULT_ROW_LIMIT;
  return Math.min(Math.max(Number(rowLimit), 1), MAX_ROW_LIMIT);
}

function parseFastPathIntent(question: string): ModelOutput | null {
  const normalized = question.toLowerCase().replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim();
  const dateRange = parseSharedDateRange(normalized);
  const hasDate = Boolean(dateRange);
  const mentionsBookings = /\b(bookings?|appointments?|acuity)\b/.test(normalized);
  const mentionsCredits = /\b(credits?|bank revenue|payments?)\b/.test(normalized);
  const mentionsDebits = /\b(debits?|expenses?)\b/.test(normalized);
  const revenueMetric = detectRevenueMetric(question);
  const unsourcedRevenue = /\brevenues?\b/.test(normalized) && !revenueMetric && !/\bbank revenue\b/.test(normalized);
  const dateBasis = detectAcuityDateBasis(question);
  const groupBy = detectGrouping(question);
  const wantsTotalSummary = hasAggregateWording(normalized);
  const wantsRows = hasRowWording(normalized);

  if (hasMonthWithoutYear(normalized)) {
    return { type: "clarification", question: "Which month and year should I use?" };
  }
  if (!dateRange && hasDateWording(normalized)) {
    return { type: "clarification", question: "What exact date range should I use?" };
  }
  if (!hasDate && !/\b(bank revenue|credits?|debits?|expenses?|payments?)\b/.test(normalized)) return null;
  if (/\bbookings?\s+by\s+date\b/.test(normalized) && !dateBasis) return null;
  if (/\bby\s+(?!month\b|calendar name\b|calendar\b|room\b|room type\b|appointment date\b|booking created date\b|created date\b|booked date\b)/.test(normalized)) return null;

  if (mentionsBookings && !mentionsCredits && !mentionsDebits && !/\brevenues?\b/.test(normalized)) {
    return {
      type: "intent",
      intent: groupBy ? "acuity_booking_by_room_type" : "acuity_booking_count",
      mode: wantsRows && !wantsTotalSummary ? "list" : "total",
      dateRange,
      groupBy,
      dateBasis: dateBasis ?? "appointment_datetime",
      searchText: null,
      revenueMetric: null,
    };
  }

  const bankSummaryMetricCount = [mentionsDebits, mentionsCredits || revenueMetric === "bank_revenue"].filter(Boolean).length;

  if (hasDate && bankSummaryMetricCount >= 2 && !mentionsBookings) {
    return {
      type: "intent",
      intent: "bank_movement_summary",
      mode: "total",
      transactionType: "both",
      metricMode: "summary",
      resultMode: "aggregate_only",
      rowLimit: DEFAULT_ROW_LIMIT,
      dateRange,
      groupBy: null,
      dateBasis: null,
      searchText: null,
      includeAcuityValue: false,
      revenueMetric: "bank_revenue",
    };
  }

  const monthlyMetricCount = [mentionsDebits, mentionsCredits || revenueMetric === "bank_revenue", mentionsBookings].filter(Boolean).length;
  if (hasDate && monthlyMetricCount >= 2) {
    if (unsourcedRevenue && !/\bbank revenue\b.*\brevenues?\b|\brevenues?\b.*\bbank revenue\b/.test(normalized)) return null;
    return {
      type: "intent",
      intent: "monthly_summary",
      mode: "both",
      dateRange,
      groupBy,
      dateBasis: dateBasis ?? "appointment_datetime",
      searchText: null,
      includeAcuityValue: revenueMetric === "acuity_value" || revenueMetric === "both",
      revenueMetric: revenueMetric ?? (mentionsCredits ? "bank_revenue" : null),
    };
  }

  if (unsourcedRevenue) return null;

  if (mentionsCredits || revenueMetric === "bank_revenue") {
    return {
      type: "intent",
      intent: "bank_credits",
      mode: wantsRows && !wantsTotalSummary ? "list" : "total",
      transactionType: "credit",
      metricMode: wantsRows && !wantsTotalSummary ? "list" : "total",
      resultMode: wantsRows && !wantsTotalSummary ? "aggregate_with_rows" : "aggregate_only",
      rowLimit: DEFAULT_ROW_LIMIT,
      dateRange,
      searchText: extractBankSearchText(question, "credit"),
      groupBy: null,
      dateBasis: null,
      revenueMetric: "bank_revenue",
    };
  }

  if (mentionsDebits) {
    return {
      type: "intent",
      intent: "bank_debits",
      mode: wantsRows && !wantsTotalSummary ? "list" : "total",
      transactionType: "debit",
      metricMode: wantsRows && !wantsTotalSummary ? "list" : "total",
      resultMode: wantsRows && !wantsTotalSummary ? "aggregate_with_rows" : "aggregate_only",
      rowLimit: DEFAULT_ROW_LIMIT,
      dateRange,
      searchText: extractBankSearchText(question, "debit"),
      groupBy: null,
      dateBasis: null,
      revenueMetric: null,
    };
  }

  return null;
}

function hasMonthWithoutYear(question: string) {
  return /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/.test(question)
    && !/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b/.test(question);
}

function parseSharedDateRange(question: string, now = new Date()): DateRange | null {
  const lastMonths = question.match(/\b(?:(?:over|for|in|during)\s+(?:the\s+)?)?(?:past|last)\s+(\d{1,2})\s+months?\b/);
  if (lastMonths) {
    const months = Number(lastMonths[1]);
    return { type: "last_months", months, label: `the past ${months} month${months === 1 ? "" : "s"}` };
  }

  const monthYear = question.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(20\d{2})\b/);
  if (monthYear) {
    const month = MONTHS[monthYear[1]];
    const year = Number(monthYear[2]);
    return { type: "month", month, year, label: `${year}-${String(month).padStart(2, "0")}` };
  }

  const yearOnly = question.match(/\b(?:(?:in|for|during)\s+(?:the\s+)?(?:year\s+)?)(20\d{2})\b|\b(?:the\s+)?year\s+(20\d{2})\b|\b(20\d{2})\s+total\b/);
  if (yearOnly) return yearRange(Number(yearOnly[1] ?? yearOnly[2] ?? yearOnly[3]));
  if (/\bthis month\b/.test(question)) return monthRange(now.getUTCFullYear(), now.getUTCMonth());
  if (/\blast month\b/.test(question)) return monthRange(now.getUTCFullYear(), now.getUTCMonth() - 1);
  if (/\bthis year\b/.test(question)) return yearRange(now.getUTCFullYear());
  return null;
}

function monthRange(year: number, zeroBasedMonth: number): DateRange {
  const start = new Date(Date.UTC(year, zeroBasedMonth, 1));
  const end = new Date(Date.UTC(year, zeroBasedMonth + 1, 1));
  return { type: "explicit", start: isoDate(start), end: isoDate(end), label: isoDate(start).slice(0, 7) };
}

function yearRange(year: number): DateRange {
  return { type: "explicit", start: `${year}-01-01`, end: `${year + 1}-01-01`, label: String(year) };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function extractBankSearchText(question: string, kind: "credit" | "debit") {
  const sourcePattern = kind === "credit"
    ? /\b(?:from|source(?:d)?\s+from)\s+(.+?)(?:\s+(?:over|for|in|during|last|past|this)\b|[?.!,]|$)/i
    : /\b(?:for|from)\s+(.+?)(?:\s+(?:over|in|during|last|this)\b|[?.!,]|$)/i;
  const source = question.match(sourcePattern)?.[1]?.trim();
  if (source && !/^(may|june?|july?|jan|feb|mar|apr|aug|sep|oct|nov|dec)\b/i.test(source)) return source;

  const beforeMetric = question.match(new RegExp(`(?:\\b(?:show|show all|list|total|sum|how many|how much|tell me all)\\s+)?(.+?)\\s+(?:${kind === "credit" ? "credits?|payments?|bank revenue" : "debits?|expenses?"})\\b`, "i"))?.[1]?.trim();
  if (beforeMetric && !/^(bank|the|me|all)$/i.test(beforeMetric)) return beforeMetric.replace(/^(all|the)\s+/i, "");
  return null;
}

function normalizeModelOutput(output: ModelOutput, question: string): ModelOutput {
  if (output.type === "clarification") return output;

  const normalized: Intent = { ...output };
  const source = detectRevenueMetric(question);
  const dateBasis = detectAcuityDateBasis(question);
  const groupBy = detectGrouping(question);
  const parsedDateRange = parseSharedDateRange(question.toLowerCase().replace(/[“”]/g, "\"").replace(/\s+/g, " ").trim());

  if (parsedDateRange) normalized.dateRange = parsedDateRange;

  const shape = resultShapeFromQuestion(question);
  const isBankTransactionIntent = normalized.intent === "bank_credits" || normalized.intent === "bank_debits" || normalized.intent === "bank_movement_summary";
  if (isBankTransactionIntent) {
    normalized.mode = shape.mode;
    normalized.metricMode = normalized.intent === "bank_movement_summary" ? "summary" : shape.metricMode;
    normalized.resultMode = normalized.intent === "bank_movement_summary" && !hasRowWording(question) ? "aggregate_only" : shape.resultMode;
    normalized.rowLimit = normalizeRowLimit(normalized.rowLimit, normalized.resultMode);
  }

  if (/\b(debits?|expenses?)\b/i.test(question) && /\b(credits?|bank revenue|payments?|revenues?)\b/i.test(question) && !/\b(bookings?|appointments?|acuity)\b/i.test(question)) {
    normalized.intent = "bank_movement_summary";
    normalized.transactionType = "both";
    normalized.metricMode = "summary";
    normalized.resultMode = hasRowWording(question) ? "aggregate_with_rows" : "aggregate_only";
    normalized.mode = normalized.resultMode === "aggregate_only" ? "total" : "list";
    normalized.rowLimit = normalizeRowLimit(normalized.rowLimit, normalized.resultMode);
    normalized.searchText = null;
  }

  if (normalized.intent === "bank_credits") normalized.transactionType = "credit";
  if (normalized.intent === "bank_debits") normalized.transactionType = "debit";
  if (normalized.intent === "bank_movement_summary") normalized.transactionType = "both";

  if ((normalized.intent === "bank_credits" || normalized.intent === "bank_debits") && !normalized.searchText) {
    normalized.searchText = extractBankSearchText(question, normalized.intent === "bank_credits" ? "credit" : "debit");
  }

  if (source) normalized.revenueMetric = source;
  if (dateBasis) normalized.dateBasis = dateBasis;
  if (!normalized.dateBasis && usesBookings(normalized, question)) normalized.dateBasis = "appointment_datetime";
  if (groupBy) {
    normalized.groupBy = groupBy;
    if (normalized.intent === "acuity_booking_count") normalized.intent = "acuity_booking_by_room_type";
  }
  if (normalized.intent === "acuity_booking_by_room_type" && !normalized.groupBy) normalized.groupBy = "calendar_name";
  if (normalized.intent === "bank_credits" && /\bpayments?\s+from\b/i.test(question) && !normalized.searchText) {
    normalized.searchText = question.replace(/^.*?\bpayments?\s+from\s+/i, "").replace(/\b(over|for|in|during|last|past)\b.*$/i, "").trim() || normalized.searchText;
  }

  return normalized;
}

function detectRevenueMetric(question: string): Intent["revenueMetric"] | null {
  if (/\b(both|all)\s+revenue\s+types?\b/i.test(question) || /\brevenue\s+(from\s+)?(both|all)\b/i.test(question)) return "both";
  if (/\bbank\s+revenue\b/i.test(question)) return "bank_revenue";
  if (/\b(acuity\s+revenue|acuity\s+appointment\s+value|appointment\s+value)\b/i.test(question)) return "acuity_value";
  return null;
}

function detectAcuityDateBasis(question: string): Intent["dateBasis"] | null {
  if (/\b(by|using|based on|basis)\s+(the\s+)?(appointment|session)\s+date\b/i.test(question)) return "appointment_datetime";
  if (/\b(by|using|based on|basis)\s+(the\s+)?(booking\s+created|created|booked)\s+date\b/i.test(question)) return "created_datetime";
  return null;
}

function detectGrouping(question: string): Intent["groupBy"] | null {
  const byMonth = /\bby\s+month\b|\bmonthly\b/i.test(question);
  const byCalendar = /\bby\s+(calendar\s+name|calendar|room\s+type|room)\b/i.test(question);
  if (byMonth && byCalendar) return "month_calendar_name";
  if (byMonth) return "month";
  if (byCalendar) return "calendar_name";
  return null;
}

function hasUnsourcedRevenue(question: string) {
  return /\brevenue\b/i.test(question) && !detectRevenueMetric(question);
}

function usesBookings(intent: Intent, question: string) {
  return intent.intent === "acuity_booking_count" || intent.intent === "acuity_booking_by_room_type" || intent.intent === "monthly_summary" || /\b(bookings?|appointments?)\b/i.test(question);
}

function needsBookingDateBasisClarification(intent: Intent, question: string) {
  return usesBookings(intent, question) && !detectAcuityDateBasis(question) && /\b(compare|group|break\s*down|show)\b.*\bbookings?\b.*\bby\s+date\b/i.test(question);
}

function getAcuityDateColumn(dateBasis: Intent["dateBasis"] | undefined | null) {
  return dateBasis === "created_datetime" ? sql`created_datetime` : sql`appointment_datetime`;
}

function validateIntent(intent: Intent, question = ""): Clarification | null {
  const allowed = new Set<IntentKind>(["bank_credits", "bank_debits", "bank_movement_summary", "acuity_booking_count", "acuity_booking_by_room_type", "monthly_summary"]);
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
  if (needsBookingDateBasisClarification(intent, question)) {
    return { type: "clarification", question: "For bookings by date, should I use appointment date or booking created date?", options: ["Appointment date", "Booking created date"] };
  }
  if (hasUnsourcedRevenue(question) && !intent.revenueMetric) {
    return { type: "clarification", question: "For revenue, do you mean bank revenue, Acuity appointment value, or both?", options: ["Bank revenue", "Acuity appointment value", "Both"] };
  }
  if (intent.intent === "bank_credits" || intent.intent === "bank_debits" || intent.intent === "bank_movement_summary") {
    if (!intent.transactionType || !["credit", "debit", "both"].includes(intent.transactionType)) {
      return { type: "clarification", question: "Should I look at bank credits, bank debits, or both?", options: ["Credits", "Debits", "Both"] };
    }
    if (intent.dateRange && intent.dateRange.type === "explicit" && intent.dateRange.start >= intent.dateRange.end) {
      return { type: "clarification", question: "What exact date range should I use?" };
    }
  }
  return null;
}

function isIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function getDateSql(range: DateRange | null | undefined, column: any) {
  if (!range) return sql``;
  if (range.type === "last_months") return sql`and ${column} >= date_trunc('month', current_date) - (${range.months - 1} * interval '1 month') and ${column} < current_date + interval '1 day'`;
  if (range.type === "month") return sql`and ${column} >= make_date(${range.year}, ${range.month}, 1) and ${column} < make_date(${range.year}, ${range.month}, 1) + interval '1 month'`;
  return sql`and ${column} >= ${range.start}::date and ${column} < ${range.end}::date`;
}

function dateLabel(range?: DateRange | null) {
  if (!range) return "all time";
  if (range.type === "last_months") return `the past ${range.months} month${range.months === 1 ? "" : "s"}`;
  if (range.type === "month") return `${range.year}-${String(range.month).padStart(2, "0")}`;
  if (range.label) return range.label;
  if (/^\d{4}-01-01$/.test(range.start) && range.end === `${Number(range.start.slice(0, 4)) + 1}-01-01`) return range.start.slice(0, 4);
  return `${range.start} to ${range.end} (exclusive)`;
}

function logStudioChat({
  source,
  output,
  clarification,
  rowCount,
}: {
  source: IntentSource;
  output: ModelOutput;
  clarification?: Clarification;
  rowCount?: number;
}) {
  const payload = output.type === "intent"
    ? {
        source,
        intent: output.intent,
        dateRange: output.dateRange ?? null,
        rowCount,
        clarified: Boolean(clarification),
      }
    : {
        source,
        intent: "clarification",
        dateRange: null,
        rowCount,
        clarified: true,
      };
  console.info("Studio Chat request:", payload);
}

async function runApprovedQuery(intent: Intent): Promise<QueryResult> {
  switch (intent.intent) {
    case "bank_credits": return runBank(intent, "credit");
    case "bank_debits": return runBank(intent, "debit");
    case "bank_movement_summary": return runBankMovementSummary(intent);
    case "acuity_booking_count": return runBookingCount(intent);
    case "acuity_booking_by_room_type": return runBookingsByRoom(intent);
    case "monthly_summary": return runMonthlySummary(intent);
  }
}

async function runBank(intent: Intent, kind: "credit" | "debit"): Promise<QueryResult> {
  const dateFilter = getDateSql(intent.dateRange, sql`transaction_date`);
  const search = intent.searchText?.trim();
  const amountColumn = kind === "credit" ? sql`credit` : sql`debit`;
  const label = kind === "credit" ? "credits" : "debits";
  const resultMode = intent.resultMode ?? (intent.mode === "list" ? "aggregate_with_rows" : "aggregate_only");
  const rowLimit = normalizeRowLimit(intent.rowLimit, resultMode);

  const totals = await sql<{ total: string | null; count: number }[]>`
    select coalesce(sum(${amountColumn}), 0)::text as total, count(*)::int as count
    from bank_transactions
    where ${amountColumn} > 0
      ${dateFilter}
      ${search ? sql`and (description_1 ilike ${`%${search}%`} or description_2 ilike ${`%${search}%`})` : sql``}
  `;
  const total = Number(totals[0]?.total ?? 0);
  const count = totals[0]?.count ?? 0;

  if (resultMode === "aggregate_only") {
    return {
      answer: `I found ${count} bank ${label}${search ? ` matching “${search}”` : ""} for ${dateLabel(intent.dateRange)}, totaling ${money.format(total)}.`,
      columns: ["period", "transaction_type", "search_text", "transaction_count", "total_amount"],
      rows: [{ period: dateLabel(intent.dateRange), transaction_type: label, search_text: search ?? null, transaction_count: count, total_amount: total.toString() }],
    };
  }

  const rows = await sql<Record<string, unknown>[]>`
    select transaction_date::text, description_1, description_2, ${kind === "credit" ? sql`credit::text as credit` : sql`debit::text as debit`}
    from bank_transactions
    where ${amountColumn} > 0
      ${dateFilter}
      ${search ? sql`and (description_1 ilike ${`%${search}%`} or description_2 ilike ${`%${search}%`})` : sql``}
    order by transaction_date desc
    limit ${rowLimit}
  `;
  const capped = count > rows.length;
  return {
    answer: `I found ${count} bank ${label}${search ? ` matching “${search}”` : ""} for ${dateLabel(intent.dateRange)}, totaling ${money.format(total)}. Showing ${capped ? `the most recent ${rows.length} of ${count}` : rows.length} matching transaction row${rows.length === 1 ? "" : "s"}, newest first${capped ? ` (capped at ${rowLimit})` : ""}.`,
    columns: ["transaction_date", "description_1", "description_2", kind],
    rows,
  };
}

async function runBankMovementSummary(intent: Intent): Promise<QueryResult> {
  const dateFilter = getDateSql(intent.dateRange, sql`transaction_date`);
  const totals = await sql<{ bank_credits: string | null; bank_debits: string | null; net_movement: string | null }[]>`
    select
      coalesce(sum(credit), 0)::text as bank_credits,
      coalesce(sum(debit), 0)::text as bank_debits,
      (coalesce(sum(credit), 0) - coalesce(sum(debit), 0))::text as net_movement
    from bank_transactions
    where transaction_date is not null
      ${dateFilter}
  `;
  const row = totals[0] ?? { bank_credits: "0", bank_debits: "0", net_movement: "0" };
  const label = summaryPeriodLabel(intent.dateRange);
  const rows = [{
    [label.column]: label.value,
    bank_credits: row.bank_credits ?? "0",
    bank_debits: row.bank_debits ?? "0",
    net_movement: row.net_movement ?? "0",
  }];
  return {
    answer: `For ${label.value}, total bank credits were ${money.format(Number(row.bank_credits ?? 0))}, total bank debits were ${money.format(Number(row.bank_debits ?? 0))}, net movement was ${money.format(Number(row.net_movement ?? 0))}.`,
    columns: [label.column, "bank_credits", "bank_debits", "net_movement"],
    rows,
  };
}

function summaryPeriodLabel(range?: DateRange | null) {
  if (range?.type === "month") return { column: "month", value: `${range.year}-${String(range.month).padStart(2, "0")}` };
  if (range?.type === "explicit" && /^\d{4}-01-01$/.test(range.start) && range.end === `${Number(range.start.slice(0, 4)) + 1}-01-01`) {
    return { column: "year", value: range.start.slice(0, 4) };
  }
  return { column: "period", value: dateLabel(range) };
}

async function runBookingCount(intent: Intent): Promise<QueryResult> {
  const dateColumn = getAcuityDateColumn(intent.dateBasis);
  const dateFilter = getDateSql(intent.dateRange, dateColumn);
  const rows = await sql<Record<string, unknown>[]>`
    select count(*)::int as booking_count
    from acuity_appointments
    where ${dateColumn} is not null and coalesce(canceled, false) is false
      ${dateFilter}
  `;
  return { answer: `I found ${rows[0]?.booking_count ?? 0} non-cancelled bookings for ${dateLabel(intent.dateRange)}.`, columns: ["booking_count"], rows };
}

async function runBookingsByRoom(intent: Intent): Promise<QueryResult> {
  const dateColumn = getAcuityDateColumn(intent.dateBasis);
  const dateFilter = getDateSql(intent.dateRange, dateColumn);

  if (intent.groupBy === "month_calendar_name") {
    const rows = await sql<Record<string, unknown>[]>`
      select
        date_trunc('month', ${dateColumn})::date::text as month_start,
        coalesce(nullif(calendar_name, ''), 'Unknown room type') as calendar_name,
        count(*)::int as booking_count
      from acuity_appointments
      where ${dateColumn} is not null and coalesce(canceled, false) is false
        ${dateFilter}
      group by 1, 2
      order by month_start asc, calendar_name asc
    `;
    return {
      answer: `I found ${rows.reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0)} non-cancelled bookings grouped by month and calendar name for ${dateLabel(intent.dateRange)}.`,
      columns: ["month_start", "calendar_name", "booking_count"],
      rows,
    };
  }

  if (intent.groupBy === "month") {
    const rows = await sql<Record<string, unknown>[]>`
      select date_trunc('month', ${dateColumn})::date::text as month_start, count(*)::int as booking_count
      from acuity_appointments
      where ${dateColumn} is not null and coalesce(canceled, false) is false
        ${dateFilter}
      group by 1
      order by month_start asc
    `;
    return {
      answer: `I found ${rows.reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0)} non-cancelled bookings grouped by month for ${dateLabel(intent.dateRange)}.`,
      columns: ["month_start", "booking_count"],
      rows,
    };
  }

  const rows = await sql<Record<string, unknown>[]>`
    select coalesce(nullif(calendar_name, ''), 'Unknown room type') as calendar_name, count(*)::int as booking_count
    from acuity_appointments
    where ${dateColumn} is not null and coalesce(canceled, false) is false
      ${dateFilter}
    group by 1 order by booking_count desc, calendar_name asc
  `;
  return { answer: `I found ${rows.reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0)} non-cancelled bookings by calendar name for ${dateLabel(intent.dateRange)}.`, columns: ["calendar_name", "booking_count"], rows };
}

async function runMonthlySummary(intent: Intent): Promise<QueryResult> {
  const bankDateFilter = getDateSql(intent.dateRange, sql`transaction_date`);
  const acuityDateColumn = getAcuityDateColumn(intent.dateBasis);
  const acuityDateFilter = getDateSql(intent.dateRange, acuityDateColumn);
  if (intent.groupBy === "calendar_name") return runMonthlySummaryByCalendar(intent, bankDateFilter, acuityDateColumn, acuityDateFilter);
  const rows = await sql<Record<string, unknown>[]>`
    with bank as (
      select date_trunc('month', transaction_date)::date as month_start, sum(coalesce(credit, 0)) as bank_revenue, sum(coalesce(debit, 0)) as bank_expenses
      from bank_transactions where transaction_date is not null ${bankDateFilter} group by 1
    ), acuity as (
      select date_trunc('month', ${acuityDateColumn})::date as month_start, count(*)::int as booking_count, sum(coalesce(price, 0)) as acuity_appointment_value
      from acuity_appointments where ${acuityDateColumn} is not null and coalesce(canceled, false) is false ${acuityDateFilter} group by 1
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


async function runMonthlySummaryByCalendar(
  intent: Intent,
  bankDateFilter: any,
  acuityDateColumn: any,
  acuityDateFilter: any,
): Promise<QueryResult> {
  const rows = await sql<Record<string, unknown>[]>`
    with bank as (
      select
        date_trunc('month', transaction_date)::date as month_start,
        sum(coalesce(credit, 0)) as bank_revenue,
        sum(coalesce(debit, 0)) as bank_expenses
      from bank_transactions
      where transaction_date is not null ${bankDateFilter}
      group by 1
    ), acuity as (
      select
        date_trunc('month', ${acuityDateColumn})::date as month_start,
        coalesce(nullif(calendar_name, ''), 'Unknown room type') as calendar_name,
        count(*)::int as booking_count,
        sum(coalesce(price, 0)) as acuity_appointment_value
      from acuity_appointments
      where ${acuityDateColumn} is not null and coalesce(canceled, false) is false ${acuityDateFilter}
      group by 1, 2
    )
    select month_start::text, 'bank_totals_not_allocated' as row_type, null::text as calendar_name,
      null::int as booking_count, bank_revenue::text, bank_expenses::text,
      (bank_revenue - bank_expenses)::text as net_movement, null::text as acuity_appointment_value
    from bank
    union all
    select month_start::text, 'acuity_bookings_by_calendar' as row_type, calendar_name,
      booking_count, null::text as bank_revenue, null::text as bank_expenses,
      null::text as net_movement, acuity_appointment_value::text
    from acuity
    order by month_start asc, row_type asc, calendar_name asc nulls first
  `;
  const totalBookings = rows.reduce((sum, row) => sum + Number(row.booking_count ?? 0), 0);
  return {
    answer: `I found ${rows.length} monthly summary row${rows.length === 1 ? "" : "s"} for ${dateLabel(intent.dateRange)}, with bank totals left unallocated and ${totalBookings} non-cancelled bookings grouped by calendar name.`,
    columns: ["month_start", "row_type", "calendar_name", "booking_count", "bank_revenue", "bank_expenses", "net_movement", "acuity_appointment_value"],
    rows,
  };
}
