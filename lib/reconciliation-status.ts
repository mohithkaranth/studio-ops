import type { ReconciliationRow } from "@/lib/stripe/reconciliation";

export const reconciliationStatuses = [
  { slug: "settled-full", label: "Settled full" },
  { slug: "settled-partial", label: "Settled partial" },
  { slug: "no-settlement", label: "No settlement" },
  { slug: "review-paynow", label: "PayNow matched" },
  { slug: "package-booking", label: "Package booking" },
  { slug: "unable-to-check", label: "Unable to check" },
] as const;

export function displayReconciliationStatus(row: ReconciliationRow) {
  return row.bankMatch.bankStatus === "Review" ? "PayNow matched" : row.status;
}
