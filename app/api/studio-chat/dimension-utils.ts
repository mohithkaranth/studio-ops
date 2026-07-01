const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LOOKUP = new Map(MONTH_LABELS.map((label, index) => [label.toLowerCase(), index + 1]));

export function sortAggregateRows(rows: Record<string, unknown>[], dimensions: string[]): Record<string, unknown>[] {
  const sortColumns = dimensionSortColumns(rows, dimensions);
  if (!sortColumns.length) return rows;
  return [...rows].sort((a, b) => compareDimensionRows(a, b, sortColumns));
}

export function formatAggregateDimensionRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, formatDimensionValue(column, value)])));
}

export function compareDimensionRows(a: Record<string, unknown>, b: Record<string, unknown>, columns: string[]): number {
  for (const column of columns) {
    const result = compareDimensionValue(column, a[column], b[column]);
    if (result !== 0) return result;
  }
  return 0;
}

export function formatDimensionValue(column: string, value: unknown): unknown {
  if (value == null) return value;
  if (isMonthColumn(column)) {
    const parsed = parseYearMonth(value);
    return parsed ? `${MONTH_LABELS[parsed.month - 1]} ${parsed.year}` : value;
  }
  if (isYearColumn(column)) {
    const parsed = parseYearMonth(value);
    return parsed ? String(parsed.year) : value;
  }
  return value;
}

function dimensionSortColumns(rows: Record<string, unknown>[], dimensions: string[]): string[] {
  const availableColumns = rows[0] ? Object.keys(rows[0]) : [];
  const requestedColumns = dimensions.map((dimension) => findColumn(availableColumns, dimension)).filter((column): column is string => Boolean(column));
  const monthColumn = findColumn(availableColumns, "month");
  const yearColumn = findColumn(availableColumns, "year");
  const temporalColumns = [yearColumn, monthColumn].filter((column): column is string => Boolean(column));
  return [...new Set([...temporalColumns, ...requestedColumns])];
}

function compareDimensionValue(column: string, a: unknown, b: unknown): number {
  if (isMonthColumn(column) || isYearColumn(column)) {
    const aTime = parseSortDateValue(a, isYearColumn(column) ? "year" : "month");
    const bTime = parseSortDateValue(b, isYearColumn(column) ? "year" : "month");
    if (aTime != null && bTime != null) return aTime - bTime;
    if (aTime != null) return -1;
    if (bTime != null) return 1;
  }
  return String(a ?? "").localeCompare(String(b ?? ""));
}

export function parseSortDateValue(value: unknown, granularity: "month" | "year" = "month"): number | null {
  const parsed = parseYearMonth(value);
  if (!parsed) return null;
  return granularity === "year" ? parsed.year : parsed.year * 12 + parsed.month;
}

function parseYearMonth(value: unknown): { year: number; month: number } | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return { year: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
  if (typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 9999) return { year: value, month: 1 };
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  const isoLike = /^(\d{4})(?:-(\d{2})(?:-\d{2})?)?/.exec(trimmed);
  if (isoLike) return validYearMonth(Number(isoLike[1]), isoLike[2] ? Number(isoLike[2]) : 1);

  const formatted = /^([A-Za-z]{3,9})\s+(\d{4})$/.exec(trimmed);
  if (formatted) {
    const month = MONTH_LOOKUP.get(formatted[1].slice(0, 3).toLowerCase());
    if (month) return validYearMonth(Number(formatted[2]), month);
  }

  return null;
}

function validYearMonth(year: number, month: number): { year: number; month: number } | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function findColumn(columns: string[], target: string): string | undefined {
  return columns.find((column) => column.toLowerCase() === target.toLowerCase());
}

function isMonthColumn(column: string): boolean {
  return column.toLowerCase() === "month";
}

function isYearColumn(column: string): boolean {
  return column.toLowerCase() === "year";
}
