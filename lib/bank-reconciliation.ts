export type PayNowTransaction = {
  id: string;
  transaction_date: string;
  description_1: string | null;
  description_2: string | null;
  credit: string;
};
export type PayNowCandidate = {
  transactionId: string;
  date: string;
  cents: number;
  payer: string;
  description: string;
  reason: "Booking reference" | "Name and amount" | "Name; different amount" | "Email name and amount" | "Email name; different amount";
  dateBasis: string;
  daysFromBooking: number | null;
  daysFromSession: number;
  shared: boolean;
};
export type BankBooking = {
  appointmentId: string;
  client: string;
  email?: string | null;
  appointmentDate: string;
  createdDate: string | null;
  costCents: number | null;
  status: string;
};
export type BankMatch = {
  candidates: PayNowCandidate[];
  confirmedCents: number | null;
  bankStatus: "Confirmed" | "Review" | "No match" | "Not checked";
};

function words(text: string) {
  return text.normalize("NFKD").replace(/\([^)]*\)/g, " ").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
}
function singaporeDay(value: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
function bookingReference(text: string, id: string) {
  return /^\d+$/.test(id) && new RegExp("(^|[^0-9])" + id + "([^0-9]|$)").test(text);
}
function dayDifference(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

export function matchPayNow(bookings: BankBooking[], transactions: PayNowTransaction[]): Map<string, BankMatch> {
  const output = new Map<string, BankMatch>();
  for (const booking of bookings) {
    const match: BankMatch = { candidates: [], confirmedCents: null, bankStatus: "Not checked" };
    output.set(booking.appointmentId, match);
    if (booking.status !== "No settlement" || booking.costCents === null || booking.costCents <= 0) continue;
    match.bankStatus = "No match";
    const name = [...new Set(words(booking.client))];
    const emailNames = [...new Set(words((booking.email ?? "").split("@")[0]).filter(word => /^[a-z]{2,}$/.test(word)))];
    const session = singaporeDay(booking.appointmentDate);
    const created = booking.createdDate ? singaporeDay(booking.createdDate) : null;
    for (const transaction of transactions) {
      const description = [transaction.description_1, transaction.description_2].filter(Boolean).join(" ");
      if (!/paynow/i.test(description)) continue;
      const cents = Math.round(Number(transaction.credit) * 100);
      if (!Number.isSafeInteger(cents) || cents <= 0) continue;
      const reference = bookingReference(description, booking.appointmentId);
      const payer = transaction.description_2?.match(/\bOTHER\s+(.+?)\s+20\d{6}[A-Z0-9]+\s+SGD\b/i)?.[1] ?? "";
      const payerWords = new Set(words(payer));
      const sameName = name.length >= 2 && name.every(word => payerWords.has(word));
      // Email names provide evidence for aliases, never proof of a settled payment.
      const sameEmailName = emailNames.length >= 2 && emailNames.every(word => payerWords.has(word));
      const daysFromSession = dayDifference(session, transaction.transaction_date);
      const daysFromBooking = created ? dayDifference(created, transaction.transaction_date) : null;
      const inPaymentPeriod = created
        ? daysFromBooking! >= 0 && daysFromSession <= 7
        : Math.abs(daysFromSession) <= 7;
      const sameAmount = cents === booking.costCents;
      const closeToKnownDate = Math.abs(daysFromSession) <= 7 || (daysFromBooking !== null && Math.abs(daysFromBooking) <= 7);
      if (!reference && !((sameName || sameEmailName) && inPaymentPeriod && (sameAmount || closeToKnownDate))) continue;
      match.candidates.push({
        transactionId: transaction.id, date: transaction.transaction_date, cents, payer, description,
        reason: reference ? "Booking reference" : sameName
          ? sameAmount ? "Name and amount" : "Name; different amount"
          : sameAmount ? "Email name and amount" : "Email name; different amount",
        dateBasis: daysFromBooking === 0 ? "On booking date"
          : daysFromSession === 0 ? "On session date"
          : daysFromBooking !== null && daysFromBooking > 0 && daysFromSession < 0 ? "Between booking and session"
          : daysFromSession > 0 ? "After session" : "Before session",
        daysFromBooking, daysFromSession,
        shared: false,
      });
    }
    match.candidates.sort((a, b) => {
      const score = (candidate: PayNowCandidate) => candidate.reason === "Booking reference" ? 0 : candidate.cents === booking.costCents ? 1 : 2;
      const proximity = (candidate: PayNowCandidate) => Math.min(Math.abs(candidate.daysFromSession), candidate.daysFromBooking === null ? Infinity : Math.abs(candidate.daysFromBooking));
      return score(a) - score(b) || proximity(a) - proximity(b) || a.date.localeCompare(b.date) || a.transactionId.localeCompare(b.transactionId);
    });
    if (match.candidates.length) match.bankStatus = "Review";
  }

  // Never allocate a transfer that references another booking, or reuse one transfer for multiple bookings.
  for (const booking of bookings) {
    const match = output.get(booking.appointmentId)!;
    for (const candidate of match.candidates) {
      candidate.shared = bookings.some(other => other.appointmentId !== booking.appointmentId &&
        bookingReference(candidate.description, other.appointmentId)) ||
        [...output.entries()].some(([id, other]) => id !== booking.appointmentId &&
          other.candidates.some(item => item.transactionId === candidate.transactionId));
    }
    const referenced = match.candidates.filter(candidate => candidate.reason === "Booking reference");
    if (referenced.length && referenced.every(candidate => !candidate.shared)) {
      match.confirmedCents = referenced.reduce((total, candidate) => total + candidate.cents, 0);
      match.bankStatus = "Confirmed";
    }
  }
  return output;
}
