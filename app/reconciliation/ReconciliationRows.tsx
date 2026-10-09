"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReconciliationRow } from "@/lib/stripe/reconciliation";

const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const date = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const amount = (cents: number | null) => cents === null ? "—" : money.format(cents / 100);

export default function ReconciliationRows({ rows }: { rows: ReconciliationRow[] }) {
  const router = useRouter();
  if (!rows.length) return <tr><td colSpan={9} className="px-4 py-8 text-center">No Acuity bookings found for September 2026.</td></tr>;
  return rows.map(row => {
    const href = "/acuity/appointments/" + encodeURIComponent(row.appointmentId);
    const review = row.bankMatch.bankStatus === "Review";
    const total = row.stripeCents === null ? null : row.stripeCents + (row.bankMatch.confirmedCents ?? 0);
    const status = review ? "Review PayNow" : row.status;
    return <tr key={row.appointmentId} className="cursor-pointer hover:bg-zinc-800/50" onClick={event => {
      if ((event.target as HTMLElement).closest("a, button, summary")) return;
      router.push(href);
    }}>
      <td className="px-4 py-3"><Link href={href} prefetch={false} className="font-medium text-zinc-100 underline decoration-zinc-600 underline-offset-4">{row.client}</Link><p className="text-xs text-zinc-500">#{row.appointmentId}</p>{row.email ? <p className="text-xs text-zinc-400">{row.email}</p> : null}</td>
      <td className="whitespace-nowrap px-4 py-3">{date.format(new Date(row.appointmentDate))}<p className="text-xs text-zinc-500">{row.room ?? "—"}</p></td>
      <td className="px-4 py-3">{row.appointmentType ?? "—"}</td>
      <td className="whitespace-nowrap px-4 py-3">{amount(row.costCents)}</td>
      <td className="whitespace-nowrap px-4 py-3">{amount(row.stripeCents)}</td>
      <td className="whitespace-nowrap px-4 py-3">{row.bankMatch.confirmedCents !== null ? amount(row.bankMatch.confirmedCents) : review ? "Possible match" : "—"}</td>
      <td className="px-4 py-3"><span className={status === "Settled full" ? "text-emerald-400" : status === "Settled partial" || review ? "text-amber-400" : status === "No settlement" ? "text-red-400" : "text-zinc-300"}>{status}</span>{row.note ? <p className="mt-1 max-w-xs text-xs text-zinc-400">{row.note}</p> : null}{!review && row.costCents !== null && total !== null ? <p className="mt-1 text-xs text-zinc-400">Difference: {amount(row.costCents - total)}</p> : null}</td>
      <td className="px-4 py-3">{row.paymentIds.length ? row.paymentIds.map((id, index) => <p key={id} className="whitespace-nowrap text-xs">{id}<br />{date.format(new Date(row.paymentDates[index]))}</p>) : "—"}</td>
      <td className="min-w-72 px-4 py-3">
        {row.bankMatch.candidates.length ? <div className="space-y-3">{row.bankMatch.candidates.map(candidate => <div key={candidate.transactionId} className="text-xs">
          <p className="font-medium text-zinc-100">{amount(candidate.cents)} · {candidate.date}</p>
          <p>{candidate.payer || "Payer name unavailable"}</p>
          <p className="text-amber-300">{candidate.reason}{candidate.shared ? " · Also a candidate for another booking" : ""}</p>
          <p className="text-zinc-500">Bank transaction #{candidate.transactionId}</p>
          <details className="mt-1"><summary className="cursor-pointer text-zinc-400">Transfer details</summary><p className="mt-1 max-w-sm whitespace-normal">{candidate.description}</p></details>
        </div>)}</div> : row.bankMatch.bankStatus === "No match" ? <p className="text-xs text-zinc-500">No candidate found by booking reference or full payer name within 7 days of the session.</p> : "—"}
      </td>
    </tr>;
  });
}
