export type ReconciliationPeriod = { year: number; month: number };
export const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function periodLabel(year: number, month: number) {
  return `${monthNames[month - 1]} ${year}`;
}
export function availablePeriod(periods: ReconciliationPeriod[], year: number, month: number) {
  return periods.some(period => period.year === year && period.month === month);
}
export function defaultPeriod(periods: ReconciliationPeriod[]) {
  // Keep the existing report period when available.
  const existing = periods.find(period => period.year === 2026 && period.month === 9);
  return existing ?? [...periods].sort((a, b) => b.year - a.year || b.month - a.month)[0] ?? null;
}
