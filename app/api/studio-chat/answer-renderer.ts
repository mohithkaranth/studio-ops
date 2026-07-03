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
    return { answer: aggregateAnswer(query, rows), columns: columnsFor(rows), rows };
  }
  const rows = result.rows ?? [];
  const summary = result.summaryRows?.[0] ?? {};
  const totalCount = Number(summary.total_count ?? rows.length);
  if (query.domain === "acuity") {
    return { answer: `Showing appointment rows${scopeLabel(query)}. Showing latest ${rows.length} of ${totalCount} matching rows.`, columns: columnsFor(rows), rows };
  }
  const parts = [`Showing latest ${rows.length} of ${totalCount} matching rows.`];
  if (query.filters?.transactionType === "credit") parts.push(`Total credit: ${money.format(Number(summary.total_credit ?? 0))}.`);
  else if (query.filters?.transactionType === "debit") parts.push(`Total debit: ${money.format(Number(summary.total_debit ?? 0))}.`);
  else parts.push(`Total credit: ${money.format(Number(summary.total_credit ?? 0))}; total debit: ${money.format(Number(summary.total_debit ?? 0))}; net movement: ${money.format(Number(summary.net_movement ?? 0))}.`);
  return { answer: parts.join(" "), columns: columnsFor(rows), rows };
}

function columnsFor(rows: Record<string, unknown>[]): string[] {
  return rows[0] ? Object.keys(rows[0]) : [];
}


function aggregateAnswer(query: SemanticQueryPayload, rows: Record<string, unknown>[]): string {
  if (!isComparisonQuery(query) && query.domain === "acuity" && query.metrics.includes("booking_count") && !(query.dimensions ?? []).length) {
    const count = Number(rows[0]?.booking_count ?? 0);
    return `Total bookings${scopeLabel(query)}: ${count}.`;
  }
  if (!isComparisonQuery(query) && query.orderBy && (query.dimensions ?? []).length) return `Here are the top ${query.rowLimit ?? rows.length} ${topNoun(query)}${scopeLabel(query)}.`;
  if (!isComparisonQuery(query) && query.domain === "acuity" && (query.dimensions ?? []).length) {
    return `Found ${rows.length} aggregate ${rows.length === 1 ? "result" : "results"}${dateBasisSuffix(query)}.`;
  }
  if (!isComparisonQuery(query) && !(query.dimensions ?? []).length && query.metrics.length === 1) {
    const metric = query.metrics[0];
    const value = Number(rows[0]?.[metric] ?? 0);
    if (metric === "average_booking_price") return `For${scopeLabel(query)}, the average booking price was ${money.format(value)}.`;
    if (metric === "highest_booking_price") return `For${scopeLabel(query)}, the highest booking price was ${money.format(value)}.`;
    if (metric === "lowest_booking_price") return `For${scopeLabel(query)}, the lowest booking price was ${money.format(value)}.`;
    if (metric === "average_bank_credit") return `For${scopeLabel(query)}, the average bank credit was ${money.format(value)}.`;
    if (metric === "highest_bank_credit") return `For${scopeLabel(query)}, the highest bank credit was ${money.format(value)}.`;
    if (metric === "lowest_bank_debit") return `For${scopeLabel(query)}, the lowest bank debit was ${money.format(value)}.`;
  }
  return `Found ${rows.length} aggregate ${rows.length === 1 ? "result" : "results"}.`;
}

function scopeLabel(query: SemanticQueryPayload): string {
  if (isComparisonQuery(query)) return "";
  const parts: string[] = [];
  if (query.filters?.searchText) parts.push(`for ${query.filters.searchText}`);
  if (query.dateRange?.label) parts.push(`for ${query.dateRange.label}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

function topNoun(query: Exclude<SemanticQueryPayload, { kind: "comparison" }>): string {
  if ((query.dimensions ?? []).includes("client_name")) return "clients";
  if ((query.dimensions ?? []).includes("calendar_name")) return "rooms";
  if ((query.dimensions ?? []).includes("appointment_type_name")) return "appointment types";
  return "results";
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
