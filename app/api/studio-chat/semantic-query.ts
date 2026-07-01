export type Domain = "bank" | "acuity";

export type ResultMode = "aggregate_only" | "rows_only" | "aggregate_with_rows";

export type DateRange = {
  startDate: string;
  endDateExclusive: string;
  label?: string;
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
  clarification?: {
    needed: boolean;
    question: string;
    options?: string[];
  };
};

export const DEFAULT_ROW_LIMIT = 50;
export const MAX_ROW_LIMIT = 100;

export function normalizeRowLimit(resultMode: ResultMode, rowLimit: unknown): number {
  if (resultMode === "aggregate_only") return 0;
  if (!Number.isFinite(rowLimit)) return DEFAULT_ROW_LIMIT;
  return Math.min(Math.max(Math.trunc(Number(rowLimit)), 1), MAX_ROW_LIMIT);
}
