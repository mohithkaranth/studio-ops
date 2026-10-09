import Link from "next/link";
import { notFound } from "next/navigation";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const date = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" });
const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (value instanceof Date) return date.format(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}
function rawRecord(value: unknown) {
  let record = value;
  for (let attempt = 0; attempt < 2 && typeof record === "string"; attempt++) {
    try { record = JSON.parse(record); } catch { break; }
  }
  return record;
}

export default async function AcuityAppointmentDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const records = await sql<Record<string, unknown>[]>`
    SELECT * FROM acuity_appointments WHERE acuity_appointment_id = ${id} LIMIT 1
  `;
  const record = records[0];
  if (!record) notFound();
  const client = [record.client_first_name, record.client_last_name].filter(Boolean).join(" ") || "Unknown client";
  const cost = record.price === null || record.price === undefined ? "—" : money.format(Number(record.price));
  const fields: [string, unknown][] = [
    ["Appointment ID", record.acuity_appointment_id],
    ["Client", client],
    ["Email", record.client_email],
    ["Phone", record.client_phone],
    ["Appointment type", record.appointment_type_name],
    ["Appointment type ID", record.appointment_type_id],
    ["Room / Calendar", record.calendar_name],
    ["Session date (Singapore)", record.appointment_datetime],
    ["Booking created (Singapore)", record.created_datetime],
    ["Acuity cost", cost],
    ["Acuity paid status", record.paid_status],
    ["Cancelled", record.canceled],
    ["Cancellation date", record.canceled_datetime],
    ["Certificate / Package code", record.certificate_code],
    ["Package inferred", record.package_inferred],
    ["Package note", record.package_inference_reason],
    ["Last synced", record.synced_at],
  ];
  return <main className="mx-auto w-full max-w-5xl space-y-6 px-6 py-10 sm:px-8 lg:px-10">
    <Link href="/reconciliation" className="text-sm text-zinc-300 underline underline-offset-4">← Back to Reconciliation</Link>
    <header className="space-y-2"><h1 className="text-3xl font-semibold text-zinc-50">{client}</h1><p className="text-sm text-zinc-400">Acuity booking #{id}</p></header>
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="mb-4 text-lg font-semibold text-zinc-100">Appointment details</h2>
      <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-xs uppercase tracking-wide text-zinc-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-sm text-zinc-100">{display(value)}</dd></div>)}</dl>
    </section>
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-5">
      <h2 className="text-lg font-semibold text-zinc-100">Full Acuity record</h2>
      <p className="mt-1 text-xs text-zinc-400">Appointment data stored by the latest Acuity sync, including any additional booking fields.</p>
      <pre className="mt-4 overflow-auto whitespace-pre-wrap break-words text-xs text-zinc-300">{JSON.stringify(rawRecord(record.raw_json), null, 2) ?? "No additional record available."}</pre>
    </section>
  </main>;
}
