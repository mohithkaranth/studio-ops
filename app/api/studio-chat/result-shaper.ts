import { isComparisonQuery, type ComparisonQuery, type SemanticQuery, type SemanticQueryPayload } from "./semantic-query";
import { sortAggregateRows } from "./dimension-utils";
import { buildAggregateQuery, buildRowSummaryQuery, buildRowsQuery } from "./sql-builder";

export type ShapedResult = {
  mode: SemanticQuery["resultMode"];
  aggregateRows?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  summaryRows?: Record<string, unknown>[];
};

const COMPARISON_METRIC_ALIASES: Record<string, string> = {
  bank_credits: "bank_credits",
  bank_debits: "bank_debits",
  net_movement: "net_movement",
  transaction_count: "bank_transaction_count",
  booking_count: "acuity_booking_count",
  booking_value: "acuity_booking_value",
};

export async function executeSemanticQuery(query: SemanticQueryPayload): Promise<ShapedResult> {
  if (isComparisonQuery(query)) return executeComparisonQuery(query);
  if (query.resultMode === "aggregate_only") {
    const aggregateRows = await buildAggregateQuery(query);
    return { mode: query.resultMode, aggregateRows: sortAggregateRows(aggregateRows, query.dimensions ?? []) };
  }
  if (!query.rowLimit) throw new Error("Row result modes require a normalized rowLimit");
  const [rows, summaryRows] = await Promise.all([buildRowsQuery(query), buildRowSummaryQuery(query)]);
  return { mode: query.resultMode, rows, summaryRows };
}

async function executeComparisonQuery(query: ComparisonQuery): Promise<ShapedResult> {
  const childRows = await Promise.all(query.queries.map((child) => buildAggregateQuery({ ...child, resultMode: "aggregate_only", rowLimit: 0 })));
  return { mode: "aggregate_only", aggregateRows: mergeComparisonRows(query, childRows) };
}

function mergeComparisonRows(query: ComparisonQuery, childRows: Record<string, unknown>[][]): Record<string, unknown>[] {
  const dimensions = comparisonDimensions(query);
  const fallbackKey = "period";
  const rowsByKey = new Map<string, Record<string, unknown>>();

  query.queries.forEach((child, childIndex) => {
    for (const sourceRow of childRows[childIndex] ?? []) {
      const key = dimensions.length ? dimensions.map((dimension) => String(sourceRow[dimension] ?? "")).join("|") : fallbackKey;
      const row = rowsByKey.get(key) ?? baseComparisonRow(dimensions, sourceRow);
      for (const metric of child.metrics) row[COMPARISON_METRIC_ALIASES[metric] ?? metric] = Number(sourceRow[metric] ?? 0);
      rowsByKey.set(key, row);
    }
  });

  if (!rowsByKey.size && !dimensions.length) rowsByKey.set(fallbackKey, { period: "total" });
  const rows = [...rowsByKey.values()];
  const metricAliases = [...new Set(query.queries.flatMap((child) => child.metrics.map((metric) => COMPARISON_METRIC_ALIASES[metric] ?? metric)))];
  rows.forEach((row) => metricAliases.forEach((alias) => { row[alias] ??= 0; }));
  return sortAggregateRows(rows, dimensions);
}

function comparisonDimensions(query: ComparisonQuery): ("month" | "year")[] {
  const dimensions = query.joinBy?.filter((dimension): dimension is "month" | "year" => dimension === "month" || dimension === "year") ?? [];
  if (dimensions.length) return [...new Set(dimensions)];
  return [...new Set(query.queries.flatMap((child) => child.dimensions ?? []).filter((dimension): dimension is "month" | "year" => dimension === "month" || dimension === "year"))];
}

function baseComparisonRow(dimensions: ("month" | "year")[], sourceRow: Record<string, unknown>): Record<string, unknown> {
  if (!dimensions.length) return { period: "total" };
  return Object.fromEntries(dimensions.map((dimension) => [dimension, sourceRow[dimension]]));
}
