import type { SemanticQuery } from "./semantic-query";

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

export async function extractSemanticQuery(question: string): Promise<SemanticQuery> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: question }],
      text: { format: { type: "json_object" } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
  const data = await response.json();
  const text = extractResponseText(data);
  if (!text) throw new Error("OpenAI returned no JSON text");
  return JSON.parse(text) as SemanticQuery;
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

const SYSTEM_PROMPT = `You extract a Studio Ops SemanticQuery as JSON only. Never write SQL. Use only these keys: domain, metrics, dimensions, filters, dateRange, resultMode, rowLimit, clarification.
Shape: {"domain":"bank|acuity","metrics":[string],"dimensions":[string],"filters":{"searchText":string|null,"transactionType":"credit|debit|both|null","dateBasis":"transaction_date|value_date|appointment_datetime|created_datetime|null"},"dateRange":{"startDate":"YYYY-MM-DD","endDateExclusive":"YYYY-MM-DD","label":string}|null,"resultMode":"aggregate_only|rows_only|aggregate_with_rows","rowLimit":number,"clarification":{"needed":boolean,"question":string,"options":[string]}}.
Bank: bank revenue / credits / income / incoming => bank_credits. expenses / debits / outgoing / outgoings => bank_debits. credits and debits / revenue and expenses / debit and credit => bank_credits, bank_debits, net_movement. Named source/vendor/person/reference goes into filters.searchText (Stripe, Grab, Muhammad, rent, PayNow, FAST PAYMENT). Payments from a person/source usually means bank_credits with searchText.
Acuity: booking count / bookings / appointments count => booking_count. booking value / appointment value / Acuity revenue => booking_value. by month/monthly => dimension month. by calendar name / by calendar / by room / by room type => calendar_name. by appointment type / service => appointment_type_name.
Date basis: bank default transaction_date. Acuity default appointment_datetime. booking created date / created date / booked date => created_datetime. appointment date/session date => appointment_datetime.
Result mode: how much, total, sum, summary, overall, amount => aggregate_only. list, details, transactions, payments, tell me all, show all => aggregate_with_rows for bank row style questions. grouped Acuity questions are aggregate_only unless user explicitly asks for appointment row details.
Ambiguity: unsourced "revenue" should clarify: bank revenue, Acuity booking value, both. Do not guess if choice changes result.
Dates: You may return dateRange, but the server date parser will override/repair.`;
