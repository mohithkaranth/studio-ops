import type { SemanticQueryPayload } from "./semantic-query";

const MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";

export async function extractSemanticQuery(question: string): Promise<SemanticQueryPayload> {
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
  return JSON.parse(text) as SemanticQueryPayload;
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

const SYSTEM_PROMPT = `You extract a Studio Ops SemanticQueryPayload as JSON only. Never write SQL.
Return either a single SemanticQuery or a ComparisonQuery.

Single SemanticQuery shape: {"domain":"bank|acuity","metrics":[string],"dimensions":[string],"filters":{"searchText":string|null,"transactionType":"credit|debit|both|null","dateBasis":"transaction_date|value_date|appointment_datetime|created_datetime|null"},"dateRange":{"startDate":"YYYY-MM-DD","endDateExclusive":"YYYY-MM-DD","label":string}|null,"resultMode":"aggregate_only|rows_only|aggregate_with_rows","rowLimit":number,"clarification":{"needed":boolean,"question":string,"options":[string]}}.

ComparisonQuery shape: {"kind":"comparison","label":string,"queries":[SemanticQuery],"joinBy":["period"|"month"|"year"],"resultMode":"aggregate_only","clarification":{"needed":boolean,"question":string,"options":[string]}}.
Use ComparisonQuery for explicit side-by-side aggregate comparisons: side by side, compare, comparison, versus, vs, bank and Acuity, Acuity and bank, both bank and Acuity, bank credits and bookings, bank debits and bookings, bank movement and bookings, revenue and booking count, payments and appointments.
ComparisonQuery is generic. It may combine any allowed metrics from bank and Acuity. It must always use resultMode aggregate_only and child queries must not be row queries.

Bank metrics: bank_credits, bank_debits, net_movement, transaction_count.
Bank wording: bank revenue / credits / income / incoming / inflows / payments received => bank_credits. expenses / debits / outgoing / outgoings / outflows => bank_debits. credits and debits / revenue and expenses / debit and credit / bank movement => bank_credits, bank_debits, net_movement. transaction count => transaction_count. Named source/vendor/person/reference goes into filters.searchText (Stripe, Grab, Muhammad, rent, PayNow, FAST PAYMENT). Payments from a person/source usually means bank_credits with searchText.

Acuity metrics: booking_count, booking_value.
Acuity wording: booking count / bookings / appointments / appointments count => booking_count. booking value / appointment value / Acuity revenue => booking_value. by calendar name / by calendar / by room / by room type => calendar_name. by appointment type / service => appointment_type_name.

Dimensions: by month/monthly => month. by year/yearly => year. For comparison queries, use shared dimensions month/year on every child when requested. Domain-specific dimensions like calendar_name should only be on Acuity single-domain queries unless the user clearly asks for an Acuity-specific breakdown.

Date basis: bank default transaction_date. Acuity default appointment_datetime. booking created date / created date / booked date => created_datetime. appointment date/session date => appointment_datetime.
Result mode for single queries: how much, total, sum, summary, overall, amount => aggregate_only. list, details, transactions, payments, tell me all, show all => aggregate_with_rows for bank row style questions. grouped Acuity questions are aggregate_only unless user explicitly asks for appointment row details.

Ambiguity: unsourced "revenue" in a single-domain-looking question should clarify: bank revenue, Acity booking value, both. If both bank and Acuity are explicitly mentioned, do not clarify just because there are multiple domains; return a ComparisonQuery. Clarify only when the metric itself is unclear.
Examples: "show revenue for May 2026" => clarification. "show bank and acuity revenue for May 2026 side by side" => comparison with bank_credits and booking_value. "compare bank credits and booking count for 2026" => comparison with bank_credits and booking_count. "show bank debits and booking count by month for 2026" => comparison with month on both children.
Dates: You may return dateRange, but the server date parser will override/repair.`;
