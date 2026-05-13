import Link from "next/link";

export default function Home() {
  const dashboardCards = [
    { title: "Acuity Bookings", href: "/acuity/dashboard" },
    { title: "Stripe Payments" },
    { title: "Bank Statement Upload" },
    { title: "Reports" },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-6 py-14 sm:px-10 lg:px-12">
        <header className="space-y-3">
          <h1 className="text-4xl font-semibold tracking-tight text-zinc-50 sm:text-5xl">
            Studio Ops
          </h1>
          <p className="max-w-2xl text-base text-zinc-400 sm:text-lg">
            Acuity, Stripe, and bank statement analytics for Tonehouse Studios
          </p>
        </header>

        <section className="grid gap-4 sm:grid-cols-2">
          {dashboardCards.map((card) => (
            <article
              key={card.title}
              className="group rounded-2xl border border-zinc-800 bg-zinc-900/80 p-6 shadow-sm transition-colors hover:border-zinc-700 hover:bg-zinc-900"
            >
              <h2 className="text-lg font-medium text-zinc-100">{card.title}</h2>
              <p className="mt-2 text-sm text-zinc-400">
                Placeholder module — coming soon.
              </p>
              {card.href ? (
                <Link
                  href={card.href}
                  className="mt-4 inline-flex text-sm font-medium text-zinc-200 underline decoration-zinc-700 underline-offset-4 transition-colors hover:text-zinc-50"
                >
                  Open Acuity dashboard
                </Link>
              ) : null}
            </article>
          ))}
        </section>
      </main>
    </div>
  );
}
