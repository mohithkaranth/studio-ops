import { sql } from "@/lib/db";
import { semanticModel, type DateBasis } from "./semantic-model";
import type { SemanticQuery } from "./semantic-query";
import { acuityClientSearchTerms } from "./acuity-client-matching";

export type BuiltQuery = Promise<Record<string, unknown>[]>;

type SqlParts = { where: string[]; params: (string | number)[] };

const ACUITY_REPORT_TIME_ZONE = "Asia/Singapore";

function runUnsafe(queryText: string, params: (string | number)[]): BuiltQuery {
  console.info("Studio Chat generated SQL", { sql: queryText, params });
  return sql.unsafe(queryText, params) as BuiltQuery;
}

export function buildAggregateQuery(query: SemanticQuery): BuiltQuery {
  const model = semanticModel[query.domain];
  const dimensions = query.dimensions ?? [];
  const select: string[] = [];
  const dateBasis = selectedDateBasis(query);
  dimensions.forEach((name) => {
    select.push(`${dimensionExpression(query, name, dateBasis)} AS ${name}`);
  });
  query.metrics.forEach((name) => select.push(`${model.metrics[name].expression} AS ${name}`));
  const parts = buildWhere(query);
  const groupBy = dimensions.length ? ` GROUP BY ${dimensions.map((_, i) => i + 1).join(", ")}` : "";
  const orderBy = dimensions.length ? ` ORDER BY ${dimensions.map((_, i) => i + 1).join(", ")}` : "";
  return runUnsafe(`SELECT ${select.join(", ")} FROM ${model.table}${whereSql(parts.where)}${groupBy}${orderBy}`, parts.params);
}

export function buildRowsQuery(query: SemanticQuery): BuiltQuery {
  if (!query.rowLimit) throw new Error("Rows query requires a LIMIT");
  const model = semanticModel[query.domain];
  const parts = buildWhere(query);
  parts.params.push(query.rowLimit);
  const orderDate = selectedDateBasis(query);
  return runUnsafe(`SELECT ${model.rowFields.join(", ")} FROM ${model.table}${whereSql(parts.where)} ORDER BY ${orderDate} DESC, id DESC LIMIT $${parts.params.length}`, parts.params);
}

export function buildRowSummaryQuery(query: SemanticQuery): BuiltQuery {
  if (query.domain === "acuity") {
    const parts = buildWhere(query);
    return runUnsafe(`SELECT COUNT(*) AS total_count FROM acuity_appointments${whereSql(parts.where)}`, parts.params);
  }

  if (query.domain !== "bank") throw new Error("Bank row summary is only supported for bank queries");
  const parts = buildWhere(query);
  return runUnsafe(`SELECT COUNT(*) AS total_count, SUM(COALESCE(credit, 0)) AS total_credit, SUM(COALESCE(debit, 0)) AS total_debit, SUM(COALESCE(credit, 0)) - SUM(COALESCE(debit, 0)) AS net_movement FROM bank_transactions${whereSql(parts.where)}`, parts.params);
}

function buildWhere(query: SemanticQuery): SqlParts {
  const where: string[] = [];
  const params: (string | number)[] = [];
  const dateBasis = selectedDateBasis(query);
  if (query.dateRange) {
    params.push(query.dateRange.startDate);
    const startPlaceholder = datePlaceholder(query.domain, params.length);
    where.push(`${dateBasis} >= ${startPlaceholder}`);
    params.push(query.dateRange.endDateExclusive);
    const endPlaceholder = datePlaceholder(query.domain, params.length);
    where.push(`${dateBasis} < ${endPlaceholder}`);
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

  if (query.domain === "acuity") {
    const clientWhere = buildAcuityClientWhere(query.filters?.searchText, params);
    if (clientWhere) where.push(clientWhere);
  }
  return { where, params };
}
function buildAcuityClientWhere(searchText: string | null | undefined, params: (string | number)[]): string | null {
  const terms = acuityClientSearchTerms(searchText);
  if (!terms.length) return null;

  const expressions: string[] = [];
  if (terms.length > 1) {
    params.push(`%${terms.join(" ")}%`);
    expressions.push(`LOWER(CONCAT_WS(' ', client_first_name, client_last_name)) LIKE $${params.length}`);
  }

  for (const term of terms) {
    params.push(`%${term}%`);
    const placeholder = `$${params.length}`;
    expressions.push(`LOWER(client_first_name) LIKE ${placeholder}`);
    expressions.push(`LOWER(client_last_name) LIKE ${placeholder}`);
    expressions.push(`LOWER(client_email) LIKE ${placeholder}`);
  }

  return `(${expressions.join(" OR ")})`;
}

function datePlaceholder(domain: SemanticQuery["domain"], paramIndex: number): string {
  if (domain !== "acuity") return `$${paramIndex}`;
  return `($${paramIndex}::date::timestamp AT TIME ZONE '${ACUITY_REPORT_TIME_ZONE}')`;
}

function whereSql(where: string[]) { return where.length ? ` WHERE ${where.join(" AND ")}` : ""; }

function defaultMetricFilters(query: SemanticQuery): string[] {
  const model = semanticModel[query.domain];
  if (query.domain === "bank" && (query.metrics.includes("net_movement") || (query.metrics.includes("bank_credits") && query.metrics.includes("bank_debits")))) return [];
  return [...new Set(query.metrics.map((metric) => model.metrics[metric].defaultFilter).filter((filter): filter is string => Boolean(filter)))];
}


function selectedDateBasis(query: SemanticQuery): DateBasis {
  const model = semanticModel[query.domain];
  const requested = query.filters?.dateBasis;
  return requested && model.allowedDateBases.includes(requested) ? requested : model.defaultDateBasis;
}

function dimensionExpression(query: SemanticQuery, name: string, dateBasis: DateBasis): string {
  const dimension = semanticModel[query.domain].dimensions[name];
  if ((name === "month" || name === "year") && isTemporalDateBasis(dateBasis)) return `date_trunc('${name}', ${dateBasis})::date`;
  return dimension.expression ?? dimension.column ?? name;
}

function isTemporalDateBasis(dateBasis: DateBasis): boolean {
  return dateBasis === "transaction_date" || dateBasis === "value_date" || dateBasis === "appointment_datetime" || dateBasis === "created_datetime";
}
