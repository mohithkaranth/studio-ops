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

export function septemberRange(year: number, month: number) {
  if (year !== 2026 || month !== 9) {
    throw new Error("Testing is currently limited to September 2026.");
  }
  return { from: "2026-09-01T00:00:00+08:00", to: "2026-10-01T00:00:00+08:00" };
}
