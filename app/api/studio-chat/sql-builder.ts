import { sql } from "@/lib/db";
import { semanticModel } from "./semantic-model";
import type { SemanticQuery } from "./semantic-query";

export type BuiltQuery = Promise<Record<string, unknown>[]>;

type SqlParts = { where: string[]; params: (string | number)[] };

export function buildAggregateQuery(query: SemanticQuery): BuiltQuery {
  const model = semanticModel[query.domain];
  const dimensions = query.dimensions ?? [];
  const select: string[] = [];
  dimensions.forEach((name) => {
    const dimension = model.dimensions[name];
    select.push(`${dimension.expression ?? dimension.column} AS ${name}`);
  });
  query.metrics.forEach((name) => select.push(`${model.metrics[name].expression} AS ${name}`));
  const parts = buildWhere(query);
  const groupBy = dimensions.length ? ` GROUP BY ${dimensions.map((_, i) => i + 1).join(", ")}` : "";
  const orderBy = dimensions.length ? ` ORDER BY ${dimensions.map((_, i) => i + 1).join(", ")}` : "";
  return sql.unsafe(`SELECT ${select.join(", ")} FROM ${model.table}${whereSql(parts.where)}${groupBy}${orderBy}`, parts.params) as BuiltQuery;
}

export function buildRowsQuery(query: SemanticQuery): BuiltQuery {
  if (query.domain !== "bank") throw new Error("Rows are only supported for bank queries in Phase 1");
  if (!query.rowLimit) throw new Error("Rows query requires a LIMIT");
  const model = semanticModel.bank;
  const parts = buildWhere(query);
  parts.params.push(query.rowLimit);
  return sql.unsafe(`SELECT ${model.rowFields.join(", ")} FROM ${model.table}${whereSql(parts.where)} ORDER BY transaction_date DESC, id DESC LIMIT $${parts.params.length}`, parts.params) as BuiltQuery;
}

export function buildBankRowSummaryQuery(query: SemanticQuery): BuiltQuery {
  if (query.domain !== "bank") throw new Error("Bank row summary is only supported for bank queries");
  const parts = buildWhere(query);
  return sql.unsafe(`SELECT COUNT(*) AS total_count, SUM(COALESCE(credit, 0)) AS total_credit, SUM(COALESCE(debit, 0)) AS total_debit, SUM(COALESCE(credit, 0)) - SUM(COALESCE(debit, 0)) AS net_movement FROM bank_transactions${whereSql(parts.where)}`, parts.params) as BuiltQuery;
}

function buildWhere(query: SemanticQuery): SqlParts {
  const model = semanticModel[query.domain];
  const where: string[] = [];
  const params: (string | number)[] = [];
  const dateBasis = query.filters?.dateBasis ?? model.defaultDateBasis;
  if (query.dateRange) {
    params.push(query.dateRange.startDate);
    where.push(`${dateBasis} >= $${params.length}`);
    params.push(query.dateRange.endDateExclusive);
    where.push(`${dateBasis} < $${params.length}`);
  }
  const metricFilters = defaultMetricFilters(query);
  where.push(...metricFilters);

  if (query.domain === "bank") {
    const transactionType = query.filters?.transactionType;
    if (transactionType === "credit") where.push("credit > 0");
    if (transactionType === "debit") where.push("debit > 0");
    const searchText = query.filters?.searchText?.trim();
    if (searchText) {
      params.push(`%${searchText}%`);
      const placeholder = `$${params.length}`;
      where.push(`(${semanticModel.bank.searchTextFields?.map((field) => `${field} ILIKE ${placeholder}`).join(" OR ")})`);
    }
  }
  return { where, params };
}
function whereSql(where: string[]) { return where.length ? ` WHERE ${where.join(" AND ")}` : ""; }

function defaultMetricFilters(query: SemanticQuery): string[] {
  const model = semanticModel[query.domain];
  if (query.domain === "bank" && (query.metrics.includes("net_movement") || (query.metrics.includes("bank_credits") && query.metrics.includes("bank_debits")))) return [];
  return [...new Set(query.metrics.map((metric) => model.metrics[metric].defaultFilter).filter((filter): filter is string => Boolean(filter)))];
}
