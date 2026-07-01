import type { SemanticQuery } from "./semantic-query";
import { buildAggregateQuery, buildBankRowSummaryQuery, buildRowsQuery } from "./sql-builder";

export type ShapedResult = {
  mode: SemanticQuery["resultMode"];
  aggregateRows?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  summaryRows?: Record<string, unknown>[];
};

export async function executeSemanticQuery(query: SemanticQuery): Promise<ShapedResult> {
  if (query.resultMode === "aggregate_only") {
    return { mode: query.resultMode, aggregateRows: await buildAggregateQuery(query) };
  }
  if (!query.rowLimit) throw new Error("Row result modes require a normalized rowLimit");
  if (query.domain !== "bank") {
    return { mode: "aggregate_only", aggregateRows: await buildAggregateQuery({ ...query, resultMode: "aggregate_only", rowLimit: 0 }) };
  }
  const [rows, summaryRows] = await Promise.all([buildRowsQuery(query), buildBankRowSummaryQuery(query)]);
  return { mode: query.resultMode, rows, summaryRows };
}
