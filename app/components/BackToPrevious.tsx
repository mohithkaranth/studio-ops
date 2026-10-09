"use client";

import { useRouter } from "next/navigation";

export default function BackToPrevious({ fallbackHref = "/reconciliation" }: { fallbackHref?: string }) {
  const router = useRouter();
  return <button type="button" onClick={() => {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }} className="inline-block text-sm text-zinc-400 hover:text-zinc-100">
    ← Back
  </button>;
}
