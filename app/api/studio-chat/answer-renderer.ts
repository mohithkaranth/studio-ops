import { formatAggregateDimensionRows } from "./dimension-utils";
import { isComparisonQuery, type SemanticQueryPayload } from "./semantic-query";
import type { ShapedResult } from "./result-shaper";

export type ChatAnswer = { answer: string; columns: string[]; rows: Record<string, unknown>[] };

const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

export function renderAnswer(query: SemanticQueryPayload, result: ShapedResult): ChatAnswer {
  if (isComparisonQuery(query)) {
    const rows = formatAggregateDimensionRows(result.aggregateRows ?? []);
    return { answer: `Found ${rows.length} comparison ${rows.length === 1 ? "result" : "results"}${comparisonDateBasisSuffix(query)}.`, columns: columnsFor(rows), rows };
  }
  if (query.resultMode === "aggregate_only") {
    const rows = formatAggregateDimensionRows(result.aggregateRows ?? []);
    return { answer: `Found ${rows.length} aggregate ${rows.length === 1 ? "result" : "results"}${dateBasisSuffix(query)}.`, columns: columnsFor(rows), rows };
  }
  const rows = result.rows ?? [];
  const summary = result.summaryRows?.[0] ?? {};
  const totalCount = Number(summary.total_count ?? rows.length);
  const parts = [`Showing latest ${rows.length} of ${totalCount} matching rows.`];
  if (query.filters?.transactionType === "credit") parts.push(`Total credit: ${money.format(Number(summary.total_credit ?? 0))}.`);
  else if (query.filters?.transactionType === "debit") parts.push(`Total debit: ${money.format(Number(summary.total_debit ?? 0))}.`);
  else parts.push(`Total credit: ${money.format(Number(summary.total_credit ?? 0))}; total debit: ${money.format(Number(summary.total_debit ?? 0))}; net movement: ${money.format(Number(summary.net_movement ?? 0))}.`);
  return { answer: parts.join(" "), columns: columnsFor(rows), rows };
}

function columnsFor(rows: Record<string, unknown>[]): string[] {
  return rows[0] ? Object.keys(rows[0]) : [];
}


function dateBasisSuffix(query: SemanticQueryPayload): string {
  if (isComparisonQuery(query) || query.domain !== "acuity") return "";
  if (query.filters?.dateBasis === "created_datetime") return " by booking created date";
  if (query.filters?.dateBasis === "appointment_datetime") return " by appointment date";
  return "";
}

function comparisonDateBasisSuffix(query: SemanticQueryPayload): string {
  if (!isComparisonQuery(query)) return "";
  const hasCreatedAcuity = query.queries.some((child) => child.domain === "acuity" && child.filters?.dateBasis === "created_datetime");
  const hasAppointmentAcuity = query.queries.some((child) => child.domain === "acuity" && child.filters?.dateBasis === "appointment_datetime");
  if (hasCreatedAcuity) return " with Acuity by booking created date";
  if (hasAppointmentAcuity) return " with Acuity by appointment date";
  return "";
}
