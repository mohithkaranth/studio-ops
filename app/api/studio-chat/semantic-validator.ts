import { semanticModel } from "./semantic-model";
import type { ParsedDateMention } from "./date-parser";
import { normalizeRowLimit, type SemanticQuery } from "./semantic-query";

type Clarification = { type: "clarification"; question: string; options?: string[] };
type ValidationResult = { type: "query"; query: SemanticQuery } | Clarification;

const REVENUE_CLARIFICATION = { type: "clarification" as const, question: "For revenue, do you mean bank revenue, Acuity booking value, or both?", options: ["Bank revenue", "Acuity booking value", "Both"] };

export function validateAndNormalizeSemanticQuery(raw: SemanticQuery, question: string, parsedDate: ParsedDateMention): ValidationResult {
  if (raw?.clarification?.needed) return { type: "clarification", question: raw.clarification.question, options: raw.clarification.options };
  if (parsedDate.dateMentioned && !parsedDate.parseable) return { type: "clarification", question: "What exact date range should I use?" };
  if (isUnsourcedRevenue(question)) return REVENUE_CLARIFICATION;
  if (!raw || (raw.domain !== "bank" && raw.domain !== "acuity")) return { type: "clarification", question: "Should I look at bank transactions or Acuity bookings?", options: ["Bank", "Acuity"] };

  const model = semanticModel[raw.domain];
  const metrics = Array.isArray(raw.metrics) ? raw.metrics.filter((metric) => metric in model.metrics) : [];
  if (metrics.length === 0) return { type: "clarification", question: `Which ${raw.domain === "bank" ? "bank" : "Acuity"} metric should I use?` };
  const dimensions = Array.isArray(raw.dimensions) ? raw.dimensions.filter((dimension) => dimension in model.dimensions) : [];

  const query: SemanticQuery = {
    domain: raw.domain,
    metrics,
    dimensions,
    filters: { ...raw.filters, dateBasis: raw.filters?.dateBasis ?? model.defaultDateBasis as NonNullable<SemanticQuery["filters"]>["dateBasis"] },
    dateRange: parsedDate.parseable ? parsedDate.dateRange : raw.dateRange ?? null,
    resultMode: raw.resultMode === "rows_only" || raw.resultMode === "aggregate_with_rows" ? raw.resultMode : "aggregate_only",
  };

  query.filters = { ...query.filters, dateBasis: normalizeDateBasis(query.domain, query.filters?.dateBasis) };
  if (query.domain === "bank") {
    query.filters.transactionType = normalizeTransactionType(query.metrics, query.filters.transactionType);
    if (isCombinedBankMovement(query.metrics) && !hasRowWording(question)) query.resultMode = "aggregate_only";
  } else {
    delete query.filters.transactionType;
  }
  query.rowLimit = normalizeRowLimit(query.resultMode, raw.rowLimit);
  return { type: "query", query };
}

function normalizeDateBasis(domain: SemanticQuery["domain"], dateBasis: unknown) {
  if (domain === "bank") return dateBasis === "value_date" ? "value_date" : "transaction_date";
  return dateBasis === "created_datetime" ? "created_datetime" : "appointment_datetime";
}
function normalizeTransactionType(metrics: string[], transactionType: unknown) {
  if (transactionType === "credit" || transactionType === "debit" || transactionType === "both") return transactionType;
  if (metrics.includes("net_movement") || (metrics.includes("bank_credits") && metrics.includes("bank_debits"))) return "both";
  if (metrics.includes("bank_credits")) return "credit";
  if (metrics.includes("bank_debits")) return "debit";
  return "both";
}
function isCombinedBankMovement(metrics: string[]) { return metrics.includes("net_movement") || (metrics.includes("bank_credits") && metrics.includes("bank_debits")); }
function hasRowWording(question: string) { return /\b(show all|list|details?|transactions?|payments?|tell me all)\b/i.test(question); }
function isUnsourcedRevenue(question: string) {
  const q = question.toLowerCase();
  return /\brevenues?\b/.test(q) && !/\b(bank|acuity|booking|appointment)\b/.test(q);
}
