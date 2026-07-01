import { semanticModel, type DateBasis } from "./semantic-model";
import type { ParsedDateMention } from "./date-parser";
import { isComparisonQuery, normalizeRowLimit, type ComparisonQuery, type SemanticQuery, type SemanticQueryPayload } from "./semantic-query";

type Clarification = { type: "clarification"; question: string; options?: string[] };
type ValidationResult = { type: "query"; query: SemanticQueryPayload } | Clarification;

const REVENUE_CLARIFICATION = { type: "clarification" as const, question: "For revenue, do you mean bank revenue, Acuity booking value, or both?", options: ["Bank revenue", "Acuity booking value", "Both"] };
const SHARED_COMPARISON_DIMENSIONS = new Set(["month", "year"]);

export function validateAndNormalizeSemanticQuery(raw: SemanticQueryPayload, question: string, parsedDate: ParsedDateMention): ValidationResult {
  if (parsedDate.dateMentioned && !parsedDate.parseable) return { type: "clarification", question: "What exact date range should I use?" };
  if (isComparisonQuery(raw)) return validateComparisonQuery(raw, question, parsedDate);
  if (raw?.clarification?.needed) return { type: "clarification", question: raw.clarification.question, options: raw.clarification.options };
  if (isUnsourcedRevenue(question)) return REVENUE_CLARIFICATION;
  return validateSingleQuery(raw, question, parsedDate);
}

function validateComparisonQuery(raw: ComparisonQuery, question: string, parsedDate: ParsedDateMention): ValidationResult {
  if (raw.clarification?.needed) return { type: "clarification", question: raw.clarification.question, options: raw.clarification.options };
  if (!Array.isArray(raw.queries) || raw.queries.length < 2) return { type: "clarification", question: "Which bank and Acuity metrics should I compare?" };

  const requestedJoinBy = (raw.joinBy ?? []).filter((dimension) => dimension === "month" || dimension === "year");
  const childDimensions = raw.queries.flatMap((query) => query.dimensions ?? []).filter((dimension) => dimension === "month" || dimension === "year");
  const sharedDimensions = [...new Set([...requestedJoinBy, ...childDimensions])];
  const unsupportedDimensions = raw.queries.flatMap((query) => query.dimensions ?? []).filter((dimension) => !SHARED_COMPARISON_DIMENSIONS.has(dimension));
  if (unsupportedDimensions.length > 0) {
    return { type: "clarification", question: "For side-by-side comparisons, should I group both sides by month or by year?", options: ["By month", "By year", "No grouping"] };
  }

  const queries: SemanticQuery[] = [];
  for (const child of raw.queries) {
    const normalized = normalizeSingleQuery(child, parsedDate, "aggregate_only", sharedDimensions, question);
    if (!normalized || normalized.metrics.length === 0) return { type: "clarification", question: "Which metrics should I compare?" };
    queries.push(normalized);
  }

  return {
    type: "query",
    query: {
      kind: "comparison",
      label: raw.label,
      queries,
      joinBy: sharedDimensions.length ? sharedDimensions : raw.joinBy,
      resultMode: "aggregate_only",
    },
  };
}

function validateSingleQuery(raw: SemanticQuery, question: string, parsedDate: ParsedDateMention): ValidationResult {
  const query = normalizeSingleQuery(raw, parsedDate, undefined, undefined, question);
  if (!query) return { type: "clarification", question: "Should I look at bank transactions or Acuity bookings?", options: ["Bank", "Acuity"] };
  if (query.metrics.length === 0) return { type: "clarification", question: `Which ${raw.domain === "bank" ? "bank" : "Acuity"} metric should I use?` };
  if (query.domain === "bank" && isCombinedBankMovement(query.metrics) && !hasRowWording(question)) query.resultMode = "aggregate_only";
  query.rowLimit = normalizeRowLimit(query.resultMode, raw.rowLimit);
  return { type: "query", query };
}

function normalizeSingleQuery(raw: SemanticQuery, parsedDate: ParsedDateMention, forcedResultMode?: SemanticQuery["resultMode"], forcedDimensions?: string[], question?: string): SemanticQuery | null {
  if (!raw || (raw.domain !== "bank" && raw.domain !== "acuity")) return null;
  const model = semanticModel[raw.domain];
  const metrics = Array.isArray(raw.metrics) ? raw.metrics.filter((metric) => metric in model.metrics) : [];
  if (raw.domain === "bank" && metrics.includes("bank_credits") && metrics.includes("bank_debits") && !metrics.includes("net_movement")) metrics.push("net_movement");
  const requestedDimensions = forcedDimensions ?? raw.dimensions ?? [];
  const dimensions = Array.isArray(requestedDimensions) ? requestedDimensions.filter((dimension) => dimension in model.dimensions) : [];
  if (!dimensions.length && shouldImplyMonthlyDateGrouping(raw.domain, question, parsedDate)) dimensions.push("month");

  const query: SemanticQuery = {
    domain: raw.domain,
    metrics,
    dimensions,
    filters: { ...raw.filters, dateBasis: inferredDateBasis(raw.domain, question) ?? raw.filters?.dateBasis ?? model.defaultDateBasis as NonNullable<SemanticQuery["filters"]>["dateBasis"] },
    dateRange: parsedDate.parseable ? parsedDate.dateRange : raw.dateRange ?? null,
    resultMode: forcedResultMode ?? (raw.resultMode === "rows_only" || raw.resultMode === "aggregate_with_rows" ? raw.resultMode : "aggregate_only"),
  };

  query.filters = { ...query.filters, dateBasis: normalizeDateBasis(query.domain, query.filters?.dateBasis) };
  if (query.domain === "bank") query.filters.transactionType = normalizeTransactionType(query.metrics, query.filters.transactionType);
  else delete query.filters.transactionType;
  query.rowLimit = normalizeRowLimit(query.resultMode, raw.rowLimit);
  return query;
}

function normalizeDateBasis(domain: SemanticQuery["domain"], dateBasis: unknown): DateBasis {
  const model = semanticModel[domain];
  return typeof dateBasis === "string" && model.allowedDateBases.includes(dateBasis as DateBasis) ? dateBasis as DateBasis : model.defaultDateBasis;
}
function inferredDateBasis(domain: SemanticQuery["domain"], question?: string): DateBasis | null {
  if (!question) return null;
  const q = question.toLowerCase();
  if (domain === "bank") return /\bvalue date\b/.test(q) ? "value_date" : null;
  if (/\b(?:appointment date|session date|appointments? happening|sessions? happening|bookings? happening)\b/.test(q)) return "appointment_datetime";
  if (/\b(?:booking date|booked date|created date|created_datetime|booking created date|bookings? created|bookings? made|new bookings?|when bookings? were made|booked in)\b/.test(q)) return "created_datetime";
  return null;
}
function shouldImplyMonthlyDateGrouping(domain: SemanticQuery["domain"], question: string | undefined, parsedDate: ParsedDateMention): boolean {
  if (domain !== "acuity" || !question || parsedDate.dateRange?.label?.length !== 4) return false;
  return /\bby\s+(?:booking|booked|created|appointment|session)\s+date\b/i.test(question);
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
