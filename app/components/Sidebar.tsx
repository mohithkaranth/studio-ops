"use client";

import Link from "next/link";
import { useState } from "react";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/revenue", label: "Revenue Reports" },
  { href: "/studio-chat", label: "Studio Chat" },
  { href: "/acuity-sync", label: "Sync Acuity Data" },
  { href: "/bank-statements", label: "Upload Bank Statements" },
];

function NavLinks({ onClick }: { onClick?: () => void }) {
  return (
    <nav className="flex flex-col gap-1 px-4 py-4">
      {navItems.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onClick}
          className="rounded-md px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-900 hover:text-zinc-100"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export default function Sidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Mobile top bar */}
      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-4 backdrop-blur lg:hidden">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Studio Ops
        </p>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100"
        >
          Menu
        </button>
      </div>

      {/* Mobile drawer overlay */}
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/60"
          />

          <aside className="relative h-full w-72 border-r border-zinc-800 bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Studio Ops
              </p>

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-sm text-zinc-100"
              >
                ✕
              </button>
            </div>

            <NavLinks onClick={() => setOpen(false)} />
          </aside>
        </div>
      ) : null}

      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 border-r border-zinc-800 bg-zinc-950/95 lg:flex lg:flex-col">
        <div className="border-b border-zinc-800 px-6 py-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Studio Ops
          </p>
        </div>

        <NavLinks />
      </aside>
    </>
  );
}