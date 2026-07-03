export type Domain = "bank" | "acuity";

export type ResultMode = "aggregate_only" | "rows_only" | "aggregate_with_rows";

export type DateRange = {
  startDate: string;
  endDateExclusive: string;
  label?: string;
};

export type ClarificationRequest = {
  needed: boolean;
  question: string;
  options?: string[];
};

export type SemanticQuery = {
  domain: Domain;
  metrics: string[];
  dimensions?: string[];
  filters?: {
    searchText?: string | null;
    transactionType?: "credit" | "debit" | "both" | null;
    dateBasis?: "transaction_date" | "value_date" | "appointment_datetime" | "created_datetime" | null;
  };
  dateRange?: DateRange | null;
  resultMode: ResultMode;
  rowLimit?: number;
  orderBy?: { field: string; direction: "asc" | "desc" } | null;
  clarification?: ClarificationRequest;
};

export type ComparisonQuery = {
  kind: "comparison";
  label?: string;
  queries: SemanticQuery[];
  joinBy?: ("period" | "month" | "year")[];
  resultMode: "aggregate_only";
  clarification?: ClarificationRequest;
};

export type SemanticQueryPayload = SemanticQuery | ComparisonQuery;

export const DEFAULT_ROW_LIMIT = 50;
export const MAX_ROW_LIMIT = 100;

export function isComparisonQuery(payload: SemanticQueryPayload): payload is ComparisonQuery {
  return Boolean(payload && "kind" in payload && payload.kind === "comparison");
}

export function normalizeRowLimit(resultMode: ResultMode, rowLimit: unknown): number {
  if (resultMode === "aggregate_only") return 0;
  if (!Number.isFinite(rowLimit)) return DEFAULT_ROW_LIMIT;
  return Math.min(Math.max(Math.trunc(Number(rowLimit)), 1), MAX_ROW_LIMIT);
}
