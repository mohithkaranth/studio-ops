export type SettlementStatus =
  | "Settled full"
  | "Settled partial"
  | "No settlement"
  | "Package booking"
  | "Unable to check";

export function sgdCents(value: string | number | null): number | null {
  if (value === null) return null;
  const text = String(value).trim();
  const match = text.match(/^(\d+)(?:\.(\d{1,2})0*)?$/);
  if (!match) return null;
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(amount) ? amount : null;
}

export function settlementStatus(cost: number, payment: number, records: number): SettlementStatus {
  if (records === 0) return "No settlement";
  return cost === payment ? "Settled full" : "Settled partial";
}

export function monthRange(year: number, month: number) {
  if (!Number.isInteger(year) || year < 2026 || year > 9998 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Choose a valid month and year from January 2026 onward.");
  }
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return {
    from: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01T00:00:00+08:00`,
    to: `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-01T00:00:00+08:00`,
  };
}
