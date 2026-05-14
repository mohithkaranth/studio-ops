import Link from "next/link";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/revenue", label: "Revenue Reports" },
  { href: "/acuity-sync", label: "Sync Acuity Data" },
  { href: "/bank-statements", label: "Upload Bank Statements" },
];

export default function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-950/95 lg:flex lg:flex-col">
      <div className="border-b border-zinc-800 px-6 py-6">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Studio Ops</p>
      </div>
      <nav className="flex flex-col gap-1 px-4 py-4">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-100"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
