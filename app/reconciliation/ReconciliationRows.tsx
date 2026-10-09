"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { displayReconciliationStatus } from "@/lib/reconciliation-status";
import type { ReconciliationRow } from "@/lib/stripe/reconciliation";

const money = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });
const date = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", day: "2-digit", month: "short", year: "numeric" });
const time = new Intl.DateTimeFormat("en-SG", { timeZone: "Asia/Singapore", hour: "2-digit", minute: "2-digit" });
const amount = (cents: number | null) => cents === null ? "—" : money.format(cents / 100);

export default function ReconciliationRows({ rows, emptyMessage = "No bookings found for the selected period." }: { rows: ReconciliationRow[]; emptyMessage?: string }) {
  const router = useRouter();
  if (!rows.length) return <tr><td colSpan={8} className="px-4 py-8 text-center text-zinc-500">{emptyMessage}</td></tr>;
  return rows.map(row => {
    const href = "/acuity/appointments/" + encodeURIComponent(row.appointmentId);
    const review = row.bankMatch.bankStatus === "Review";
    const total = row.stripeCents === null ? null : row.stripeCents + (row.bankMatch.confirmedCents ?? 0);
    const status = displayReconciliationStatus(row);
    return <tr key={row.appointmentId} className="cursor-pointer hover:bg-zinc-800/50" onClick={event => {
      if ((event.target as HTMLElement).closest("a, button, summary")) return;
      router.push(href);
    }}>
      <td className="px-3 py-3"><Link href={href} prefetch={false} className="font-medium text-zinc-100 underline decoration-zinc-600 underline-offset-4">{row.client}</Link><p className="text-xs text-zinc-500">#{row.appointmentId}</p>{row.email ? <p className="break-all text-xs text-zinc-400">{row.email}</p> : null}</td>
      <td className="px-3 py-3">{row.createdDate ? <><p>{date.format(new Date(row.createdDate))}</p><p className="text-xs text-zinc-500">{time.format(new Date(row.createdDate))}</p></> : "—"}</td>
      <td className="px-3 py-3"><p>{date.format(new Date(row.appointmentDate))}</p><p className="text-xs text-zinc-500">{time.format(new Date(row.appointmentDate))} · {row.room ?? "—"}</p></td>
      <td className="px-3 py-3">{row.appointmentType ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-3">{amount(row.costCents)}</td>
      <td className="whitespace-nowrap px-3 py-3">{amount(row.stripeCents)}</td>
      <td className="whitespace-nowrap px-3 py-3">{row.bankMatch.confirmedCents !== null ? amount(row.bankMatch.confirmedCents) : review ? "Possible match" : "—"}</td>
      <td className="px-3 py-3"><span className={`inline-block rounded-full border px-2 py-1 text-xs font-medium ${status === "Settled full" ? "border-emerald-900/80 bg-emerald-950/50 text-emerald-300" : status === "Package booking" ? "border-sky-900/80 bg-sky-950/50 text-sky-300" : status === "Settled partial" || review ? "border-amber-900/80 bg-amber-950/50 text-amber-300" : status === "No settlement" ? "border-red-900/80 bg-red-950/50 text-red-300" : "border-zinc-700 bg-zinc-800/50 text-zinc-300"}`}>{status}</span>{row.note ? <p className="mt-1 max-w-xs text-xs text-zinc-400">{row.note}</p> : null}{!review && row.status !== "Package booking" && row.costCents !== null && total !== null ? <p className="mt-1 text-xs text-zinc-400">Difference: {amount(row.costCents - total)}</p> : null}</td>


    </tr>;
  });
}
