export type UnsettledBooking = {
  costCents: number | null;
  createdDate: string | null;
  appointmentDate: string;
};

export type CreditForTotal = { id: string; date: string; cents: number };
export type PaymentWindow = { from: string; to: string };

function singaporeDay(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function unsettledTotals(bookings: UnsettledBooking[], credits: CreditForTotal[], excludedIds: ReadonlySet<string>) {
  let acuityCostCents = 0;
  let missingCosts = 0;
  let missingWindows = 0;
  const windows: PaymentWindow[] = [];
  for (const booking of bookings) {
    if (booking.costCents === null) missingCosts++;
    else acuityCostCents += booking.costCents;
    const from = booking.createdDate ? singaporeDay(booking.createdDate) : null;
    const to = singaporeDay(booking.appointmentDate);
    if (!from || !to || from > to) missingWindows++;
    else windows.push({ from, to });
  }
  const counted = new Set<string>();
  let payNowCents = 0;
  for (const credit of credits) {
    if (excludedIds.has(credit.id) || counted.has(credit.id) || !Number.isSafeInteger(credit.cents) || credit.cents <= 0) continue;
    if (!windows.some(window => credit.date >= window.from && credit.date <= window.to)) continue;
    counted.add(credit.id);
    payNowCents += credit.cents;
  }
  return { acuityCostCents: missingCosts ? null : acuityCostCents, payNowCents, creditCount: counted.size,
    missingCosts, missingWindows, windows };
}
