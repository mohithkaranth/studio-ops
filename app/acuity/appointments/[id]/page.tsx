import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";
import { reconcileStripeBookings, type ReconciliationRow } from "@/lib/stripe/reconciliation";
import { displayReconciliationStatus } from "@/lib/reconciliation-status";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

type Appointment = {
  acuity_appointment_id: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  appointment_type_name: string | null;
  calendar_name: string | null;
  created_datetime: Date | string | null;
  appointment_datetime: Date | string;
  price: string | null;
  certificate_code: string | null;
  canceled: boolean | null;
  session_month: number;
  session_year: number;
};

const dateTime = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium" });
const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const amount = (cents: number | null) => cents === null ? "—" : money.format(cents / 100);
const date = (value: Date | string | null) => value ? dateTime.format(new Date(value)) : "—";

function Fields({ items }: { items: [string, string | null][] }) {
  return <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
    {items.map(([label, value]) => <div key={label}>
      <dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-100">{value || "—"}</dd>
    </div>)}
  </dl>;
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "Settled full" ? "border-emerald-900/80 bg-emerald-950/50 text-emerald-300"
    : status === "Package booking" ? "border-sky-900/80 bg-sky-950/50 text-sky-300"
    : status === "Settled partial" || status === "Review PayNow" ? "border-amber-900/80 bg-amber-950/50 text-amber-300"
    : status === "No settlement" ? "border-red-900/80 bg-red-950/50 text-red-300"
    : "border-zinc-700 bg-zinc-800/50 text-zinc-300";
  return <span className={`inline-block rounded-full border px-2 py-1 text-xs font-medium ${tone}`}>{status}</span>;
}

export default async function AcuityAppointmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const records = await sql<Appointment[]>`
    SELECT acuity_appointment_id, client_first_name, client_last_name, client_email, client_phone,
      appointment_type_name, calendar_name, created_datetime, appointment_datetime,
      price::text, certificate_code, canceled,
      EXTRACT(MONTH FROM appointment_datetime AT TIME ZONE 'Asia/Singapore')::integer AS session_month,
      EXTRACT(YEAR FROM appointment_datetime AT TIME ZONE 'Asia/Singapore')::integer AS session_year
    FROM acuity_appointments WHERE acuity_appointment_id = ${id} LIMIT 1
  `;
  const record = records[0];
  if (!record) notFound();

  const client = [record.client_first_name, record.client_last_name].filter(Boolean).join(" ") || record.client_email || "Unknown client";
  const costCents = record.price === null ? null : Math.round(Number(record.price) * 100);
  let row: ReconciliationRow | null = null;
  let issue: string | null = null;
  if (!record.certificate_code) {
    if (record.session_month !== 9 || record.session_year !== 2026) issue = "Reconciliation is currently available for September 2026 bookings.";
    else {
      try {
        row = (await reconcileStripeBookings(2026, 9)).find(item => item.appointmentId === id) ?? null;
        if (!row) issue = "This booking could not be included in the reconciliation results.";
      } catch {
        issue = "Payment evidence could not be checked. Return to Reconciliation and try again.";
      }
    }
  }
  const status = record.certificate_code ? "Package booking" : row ? displayReconciliationStatus(row) : "Unable to check";
  const settled = status === "Settled full" || status === "Settled partial";
  const confirmedBank = row?.bankMatch.confirmedCents ?? null;
  const totalPaid = row && row.stripeCents !== null ? row.stripeCents + (confirmedBank ?? 0) : null;
  const difference = costCents !== null && totalPaid !== null ? costCents - totalPaid : null;
  const cardTitle = status === "Package booking" ? "Package / Certificate"
    : status === "Review PayNow" ? "PayNow candidates — unconfirmed"
    : status === "No settlement" ? "Payment search"
    : status === "Unable to check" ? "Payment check"
    : confirmedBank !== null ? "PayNow payment" : "Stripe payment";
  const clientFields: [string, string | null][] = [
    ["Client name", client], ["Email", record.client_email], ["Telephone", record.client_phone],
  ];

  return <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Booking comparison</h1>
        <p className="text-sm text-zinc-400">Acuity booking #{id} · {client}</p>
      </header>
      <Link href="/reconciliation?month=9&year=2026&run=1" prefetch={false} className="inline-block text-sm text-zinc-400 hover:text-zinc-100">← Back to Reconciliation</Link>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-100">Acuity booking</h2>
          <StatusBadge status={status} />
        </div>
        <div className="space-y-5 p-5">
          <Fields items={[
            ["Booking ID", id], ...clientFields,
            ["Booked on (Singapore)", date(record.created_datetime)],
            ["Session date (Singapore)", date(record.appointment_datetime)],
            ["Appointment type", record.appointment_type_name],
            ["Room", record.calendar_name],
            ["Acuity cost", amount(costCents)],
            ...(record.certificate_code ? [["Package / Certificate code", record.certificate_code] as [string, string]] : []),
          ]} />
          {record.canceled ? <p className="text-sm text-amber-300">This booking is cancelled.</p> : null}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/60">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
          <h2 className="text-lg font-medium text-zinc-100">{cardTitle}</h2>
          <StatusBadge status={status} />
        </div>
        <div className="space-y-6 p-5">
          <div className="space-y-3 border-b border-zinc-800 pb-5">
            <h3 className="text-sm font-medium text-zinc-300">Booking client</h3>
            <Fields items={clientFields} />
          </div>

          {status === "Package booking" ? <>
            <Fields items={[["Package / Certificate code", record.certificate_code]]} />
            <p className="text-sm text-zinc-400">This session uses a package/certificate. No separate payment is linked here.</p>
          </> : null}

          {status === "No settlement" ? <>
            <p className="text-sm text-zinc-300">No matching payment found.</p>
            <Fields items={[
              ["Amount to match", amount(costCents)],
              ["Booked on", date(record.created_datetime)],
              ["Session date", date(record.appointment_datetime)],
            ]} />
            {row?.note ? <p className="text-sm text-zinc-400">{row.note}</p> : null}
          </> : null}

          {status === "Unable to check" ? <p role="alert" className="text-sm text-amber-300">{issue || row?.note || "Payment evidence could not be verified. This does not mean the booking is unpaid."}</p> : null}

          {row?.stripePayments.length ? <div className="space-y-4">
            {row.stripePayments.map(payment => <div key={payment.id} className="rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
              <Fields items={[
                ["Stripe payment reference", payment.id],
                ["Payment date (Singapore)", date(payment.date)],
                ["Amount paid, less refunds", amount(payment.cents)],
              ]} />
            </div>)}
          </div> : null}

          {row && (status === "Review PayNow" || confirmedBank !== null) ? <div className="space-y-4">
            {status === "Review PayNow" ? <p className="text-sm text-amber-300">These transfers are possible matches. They have not been counted as settled payments.</p> : null}
            {row.bankMatch.candidates.filter(candidate => confirmedBank === null || candidate.reason === "Booking reference").map(candidate => {
              const candidateDifference = costCents === null ? null : costCents - candidate.cents;
              return <div key={candidate.transactionId} className="space-y-4 rounded-lg border border-zinc-800 bg-zinc-950/50 p-4">
                <Fields items={[
                  ["Bank transaction", "#" + candidate.transactionId],
                  ["Payer name", candidate.payer],
                  ["Payment date", dateOnly.format(new Date(candidate.date + "T00:00:00+08:00"))],
                  ["Payment amount", amount(candidate.cents)],
                  ["Match evidence", candidate.reason],
                  ["Date relation", candidate.dateBasis],
                  ...(status === "Review PayNow" ? [["Amount difference", amount(candidateDifference)] as [string, string]] : []),
                ]} />
                <div><p className="text-xs uppercase tracking-wide text-zinc-500">Description</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-100">{candidate.description2 || "—"}</p></div>
                {candidate.shared ? <p className="text-sm text-amber-300">This transfer is also a candidate for another booking. It cannot be assigned automatically.</p> : null}
              </div>;
            })}
          </div> : null}

          {settled ? <div className="border-t border-zinc-800 pt-5">
            <Fields items={[
              ["Acuity cost", amount(costCents)],
              ["Total paid", amount(totalPaid)],
              [difference !== null && difference < 0 ? "Excess payment" : difference === 0 ? "Difference" : "Remaining balance", amount(difference === null ? null : Math.abs(difference))],
            ]} />
          </div> : null}
        </div>
      </section>
    </div>
  </main>;
}
