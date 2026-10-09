import "server-only";

import { sql } from "@/lib/db";
import { matchPayNow, type PayNowTransaction, type BankMatch } from "@/lib/bank-reconciliation";
import { septemberRange, settlementStatus, sgdCents, type SettlementStatus } from "./reconciliation-model";

type Appointment = {
  acuity_appointment_id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  appointment_datetime: Date | string;
  created_datetime: Date | string | null;
  appointment_type_name: string | null;
  calendar_name: string | null;
  price: string | number | null;
  canceled: boolean | null;
  certificate_code: string | null;
};

type StripePayment = { id: string; cents: number; created: number };
export type ReconciliationRow = {
  appointmentId: string;
  client: string;
  email: string | null;
  appointmentDate: string;
  createdDate: string | null;
  appointmentType: string | null;
  bankMatch: BankMatch;
  room: string | null;
  costCents: number | null;
  stripeCents: number | null;
  paymentIds: string[];
  paymentDates: string[];
  stripePayments: { id: string; cents: number; date: string }[];
  status: SettlementStatus;
  note: string | null;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The payment service returned an unexpected response.");
  }
  return value as Record<string, unknown>;
}

export async function reconcileStripeBookings(year: number, month: number): Promise<ReconciliationRow[]> {
  const range = septemberRange(year, month);
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
  const acuityUser = process.env.ACUITY_USER_ID?.trim();
  const acuityKey = process.env.ACUITY_API_KEY?.trim();
  if (!stripeKey || !acuityUser || !acuityKey) {
    throw new Error("Stripe and Acuity connection settings must be configured before reconciliation.");
  }

  const appointments = await sql<Appointment[]>`
    SELECT acuity_appointment_id, client_first_name, client_last_name, client_email,
      appointment_datetime, created_datetime, appointment_type_name, calendar_name, price, canceled, certificate_code
    FROM acuity_appointments
    WHERE appointment_datetime >= ${range.from}::timestamptz
      AND appointment_datetime < ${range.to}::timestamptz
    ORDER BY appointment_datetime, acuity_appointment_id
  `;

  // Match exact processor transaction IDs, irrespective of the date payment was made.
  const deadline = Date.now() + 240000;
  const acuityAuth = "Basic " + Buffer.from(acuityUser + ":" + acuityKey).toString("base64");
  const stripeCache = new Map<string, Promise<StripePayment | null>>();

  async function request(url: string, authorization: string, allowMissing = false): Promise<unknown> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The check reached its time limit. Run reconciliation again.");
    const source = url.startsWith("https://api.stripe.com/") ? "Stripe" : "Acuity";
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: authorization, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(10000, remaining)),
      });
    } catch {
      throw new Error(source + " lookup failed or timed out. Run the check again.");
    }
    const payload: unknown = await response.json().catch(() => null);
    if (allowMissing && response.status === 404) {
      const error = object(payload).error;
      if (error && object(error).code === "resource_missing") return null;
    }
    if (!response.ok) throw new Error(source + " lookup failed (HTTP " + response.status + "). Run the check again.");
    if (payload === null) throw new Error("The payment service returned an invalid response.");
    return payload;
  }

  async function stripePayment(reference: string): Promise<StripePayment | null> {
    if (!stripeCache.has(reference)) {
      stripeCache.set(reference, (async () => {
        let charge: unknown;
        const auth = "Bearer " + stripeKey;
        if (/^seti_[A-Za-z0-9]+$/.test(reference)) {
          // SetupIntents save payment details; they do not collect any money.
          return null;
        } else if (/^(ch|py)_[A-Za-z0-9]+$/.test(reference)) {
          charge = await request("https://api.stripe.com/v1/charges/" + reference, auth, true);
        } else if (/^pi_[A-Za-z0-9]+$/.test(reference)) {
          const intent = await request("https://api.stripe.com/v1/payment_intents/" + reference + "?expand[]=latest_charge", auth, true);
          if (intent === null) return null;
          const data = object(intent);
          if (data.object !== "payment_intent") throw new Error("Unexpected Stripe payment response.");
          if (!data.latest_charge) return null;
          charge = typeof data.latest_charge === "string"
            ? await request("https://api.stripe.com/v1/charges/" + encodeURIComponent(data.latest_charge), auth, true)
            : data.latest_charge;
        } else if (/^txn_[A-Za-z0-9]+$/.test(reference)) {
          const transaction = await request("https://api.stripe.com/v1/balance_transactions/" + reference, auth, true);
          if (transaction === null) return null;
          const source = object(transaction).source;
          if (typeof source !== "string" || !/^(ch|py)_[A-Za-z0-9]+$/.test(source)) {
            throw new Error("This Stripe transaction cannot be matched to a charge.");
          }
          charge = await request("https://api.stripe.com/v1/charges/" + source, auth, true);
        } else {
          throw new Error("The Acuity Stripe transaction reference is not supported.");
        }
        if (charge === null) return null;
        const data = object(charge);
        if (data.object !== "charge" || typeof data.id !== "string") throw new Error("Unexpected Stripe charge response.");
        if (data.currency !== "sgd") throw new Error("Stripe payment currency is not SGD; review this booking separately.");
        if (data.paid !== true || data.captured !== true) return null;
        const captured = data.amount_captured;
        const refunded = data.amount_refunded;
        if (!Number.isSafeInteger(captured) || !Number.isSafeInteger(refunded) ||
            typeof captured !== "number" || typeof refunded !== "number" ||
            captured < 0 || refunded < 0 || refunded > captured || typeof data.created !== "number") {
          throw new Error("Stripe payment amount could not be verified.");
        }
        return { id: data.id, cents: captured - refunded, created: data.created };
      })());
    }
    return stripeCache.get(reference)!;
  }

  const rows: ReconciliationRow[] = new Array(appointments.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(4, appointments.length) }, async () => {
    while (nextIndex < appointments.length) {
      const index = nextIndex++;
      const appointment = appointments[index];
      const row: ReconciliationRow = {
        appointmentId: String(appointment.acuity_appointment_id),
        client: [appointment.client_first_name, appointment.client_last_name].filter(Boolean).join(" ") || appointment.client_email || "Unknown",
        email: appointment.client_email,
        appointmentDate: new Date(appointment.appointment_datetime).toISOString(),
        createdDate: appointment.created_datetime ? new Date(appointment.created_datetime).toISOString() : null,
        appointmentType: appointment.appointment_type_name,
        bankMatch: { candidates: [], confirmedCents: null, bankStatus: "Not checked" },
        room: appointment.calendar_name,
        costCents: sgdCents(appointment.price),
        stripeCents: null,
        paymentIds: [],
        paymentDates: [],
        stripePayments: [],
        status: "Unable to check",
        note: appointment.canceled ? "Cancelled booking" : null,
      };
      if (appointment.certificate_code) {
        row.status = "Package booking";
        rows[index] = row;
        continue;
      }
      try {
        if (row.costCents === null) throw new Error("Acuity booking cost is missing or invalid.");
        const payload = await request(
          "https://acuityscheduling.com/api/v1/appointments/" + encodeURIComponent(row.appointmentId) + "/payments",
          acuityAuth,
        );
        if (!Array.isArray(payload)) throw new Error("Acuity payment references could not be verified.");
        const references = new Set<string>();
        for (const entry of payload) {
          const payment = object(entry);
          if (typeof payment.processor !== "string") throw new Error("Acuity payment processor could not be verified.");
          if (payment.processor.toLowerCase() !== "stripe") continue;
          if (typeof payment.transactionID !== "string" || !payment.transactionID.trim()) {
            throw new Error("Acuity Stripe payment reference is missing.");
          }
          references.add(payment.transactionID.trim());
        }
        const payments = new Map<string, StripePayment>();
        for (const reference of references) {
          const payment = await stripePayment(reference);
          if (payment) {
            payments.set(payment.id, payment);
            // Preserve retrieved evidence even if a later payment lookup fails.
            row.paymentIds = [...payments.keys()];
            row.paymentDates = [...payments.values()].map(item => new Date(item.created * 1000).toISOString());
            row.stripePayments = [...payments.values()].map(item => ({ id: item.id, cents: item.cents, date: new Date(item.created * 1000).toISOString() }));
          }
        }
        row.stripeCents = [...payments.values()].reduce((total, payment) => total + payment.cents, 0);
        row.paymentIds = [...payments.keys()];
        row.paymentDates = [...payments.values()].map(payment => new Date(payment.created * 1000).toISOString());
        row.stripePayments = [...payments.values()].map(payment => ({ id: payment.id, cents: payment.cents, date: new Date(payment.created * 1000).toISOString() }));
        row.status = settlementStatus(row.costCents, row.stripeCents, payments.size);
        if (payments.size === 0 && [...references].some(reference => /^seti_[A-Za-z0-9]+$/.test(reference))) {
          row.note = [row.note, "Card saved only; no completed Stripe payment is recorded for this booking in Acuity."].filter(Boolean).join(". ");
        }
      } catch (error) {
        row.note = [row.note, error instanceof Error ? error.message : "Payment lookup failed. Run the check again."].filter(Boolean).join(". ");
      }
      rows[index] = row;
    }
  }));

  // A shared charge cannot independently settle multiple bookings without an allocation rule.
  const owners = new Map<string, Set<string>>();
  for (const row of rows) for (const id of row.paymentIds) {
    if (!owners.has(id)) owners.set(id, new Set());
    owners.get(id)!.add(row.appointmentId);
  }
  for (const row of rows) if (row.paymentIds.some(id => owners.get(id)!.size > 1)) {
    row.status = "Unable to check";
    row.stripeCents = null;
    row.note = "Stripe payment is linked to multiple bookings and needs allocation review.";
  }
  if (rows.some(row => row.status === "No settlement" && (row.costCents ?? 0) > 0)) {
    try {
      const transactions = await sql<PayNowTransaction[]>`
        SELECT t.id::text, t.transaction_date::text, t.description_1, t.description_2, t.credit::text
        FROM bank_transactions t
        JOIN bank_statement_uploads u ON u.id = t.upload_id
        WHERE t.credit > 0 AND UPPER(u.currency) = 'SGD'
          AND (t.description_1 ILIKE '%paynow%' OR t.description_2 ILIKE '%paynow%')
        ORDER BY t.transaction_date, t.id
      `;
      const matches = matchPayNow(rows, transactions);
      for (const row of rows) {
        row.bankMatch = matches.get(row.appointmentId)!;
        if (row.bankMatch.confirmedCents !== null && row.costCents !== null) {
          row.status = settlementStatus(row.costCents, row.bankMatch.confirmedCents, 1);
        }
      }
    } catch {
      for (const row of rows) if (row.status === "No settlement" && (row.costCents ?? 0) > 0) {
        row.status = "Unable to check";
        row.note = [row.note, "Bank transaction lookup failed. Run reconciliation again."].filter(Boolean).join(". ");
      }
    }
  }
  return rows;
}
