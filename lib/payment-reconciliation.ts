export type Booking = {
  id: string;
  name: string;
  date: string;
  createdDate: string | null;
  price: string | null;
  certificateCode: string | null;
  canceled: boolean;
};

export type BankCredit = {
  id: string;
  date: string;
  description: string;
  amount: string;
  currency: string;
};

export type ProcessorPayment = {
  transactionID: string;
  processor: string;
  amount: string;
  created: string | null;
};

export type PaymentEvidence = {
  status: 'loaded' | 'error';
  payments: ProcessorPayment[];
};

export function moneyToCents(value: string | null): number | null {
  if (value === null || !/^-?\d+(\.\d{1,2}0*)?$/.test(value.trim())) return null;
  const negative = value.trim().startsWith('-');
  const [whole, fraction = ''] = value.trim().replace(/^-/, '').split('.');
  const cents = Number(whole) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? (negative ? -cents : cents) : null;
}

export function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

function words(value: string): string[] {
  return value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function hasIdentity(booking: Booking, description: string): boolean {
  const tokens = words(description);
  // A booking reference is strong evidence; a single common name is not.
  if (tokens.includes(booking.id)) return true;
  const names = words(booking.name);
  return names.length >= 2 && names.every((name) => tokens.includes(name));
}

export function suggestPayNow(
  bookings: Booking[], credits: BankCredit[], evidence: Record<string, PaymentEvidence>,
) {
  return bookings.map((booking) => {
    const processor = evidence[booking.id];
    const price = moneyToCents(booking.price);
    const amounts = processor?.payments.map((payment) => moneyToCents(payment.amount)) ?? [];
    const recordsValid = amounts.every((amount) => amount !== null);
    const processorCents = processor?.status === 'loaded' && recordsValid
      ? amounts.reduce<number>((total, amount) => total + (amount ?? 0), 0) : null;
    const remainingCents = price !== null && processorCents !== null ? price - processorCents : null;
    const hasAdjustments = amounts.some((amount) => amount !== null && amount < 0);
    const candidates = remainingCents !== null && remainingCents > 0 && !booking.canceled && !booking.certificateCode && !hasAdjustments
      ? credits.filter((credit) => {
        if (credit.currency !== 'SGD' || moneyToCents(credit.amount) !== remainingCents) return false;
        if (!/\bpay\s*now\b/i.test(credit.description) || /\bstripe\b/i.test(credit.description)) return false;
        if (!hasIdentity(booking, credit.description)) return false;
        const paymentDay = Date.parse(credit.date);
        const bookingDay = Date.parse(booking.date);
        const earliest = booking.createdDate && validDate(booking.createdDate)
          ? Math.min(Date.parse(booking.createdDate), bookingDay) : bookingDay - 30 * 86400000;
        return paymentDay >= earliest && paymentDay <= bookingDay + 7 * 86400000;
      }) : [];
    return { booking, processorCents, remainingCents, candidates, hasAdjustments };
  }).map((row, _index, rows) => ({
    ...row,
    sharedCredit: row.candidates.some((credit) => rows.some((other) =>
      other.booking.id !== row.booking.id && other.candidates.some((candidate) => candidate.id === credit.id))),
  }));
}
