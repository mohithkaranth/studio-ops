import { checkStripeConnection } from "@/lib/stripe/connection";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function ReconciliationPage() {
  const connected = await checkStripeConnection();

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-6 py-10 sm:px-8 lg:px-10">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">
        Reconciliation
      </h1>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6">
        <p className="text-sm text-zinc-400">Stripe connection</p>
        <p className={`mt-2 text-3xl font-semibold ${connected ? "text-emerald-400" : "text-red-400"}`}>
          {connected ? "Yes" : "No"}
        </p>
      </section>
    </main>
  );
}
