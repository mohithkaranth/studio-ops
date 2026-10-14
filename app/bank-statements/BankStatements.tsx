"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import BankAllocationEditor, { type StatementAllocation } from './BankAllocationEditor';
import { ignoredBankCredit } from '@/lib/bank-credit-exclusions';

type Summary = {
  statement_start_date: string;
  statement_end_date: string;
  account_number: string | null;
  transaction_count: number;
  total_debit: string | null;
  total_credit: string | null;
  net_amount: string | null;
} | null;

type Tx = {
  id: string;
  allocated_cents: number;
  paynow_matched: boolean;
  remaining_cents: number;
  allocations: StatementAllocation[];
  transaction_date: string;
  value_date: string | null;
  description_1: string | null;
  description_2: string | null;
  debit: string | null;
  credit: string | null;
  running_balance: string | null;
};

export default function BankStatementsPage() {
  const [summary, setSummary] = useState<Summary>(null);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string>("");
  const [uploads, setUploads] = useState<{ id: number; from: string; to: string }[]>([]);
  const [selectedUpload, setSelectedUpload] = useState('');

  const applyData = useCallback((data: { latest: (NonNullable<Summary> & { id: number }) | null; transactions: Tx[]; uploads: { id: number; from: string; to: string }[] }) => {
    setSummary(data.latest);
    setTransactions(data.transactions);
    setUploads(data.uploads);
    setSelectedUpload(data.latest ? String(data.latest.id) : '');
  }, []);

  const loadData = async (uploadId = selectedUpload) => {
    const res = await fetch(`/api/bank-statements/summary${uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : ''}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Unable to load bank statements.');
    applyData(data);
  };

  useEffect(() => {
    const controller = new AbortController();
    const uploadId = new URLSearchParams(window.location.search).get('uploadId');
    fetch(`/api/bank-statements/summary${uploadId ? `?uploadId=${encodeURIComponent(uploadId)}` : ''}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? 'Unable to load bank statements.');
        return data;
      }).then(data => {
        applyData(data);
        if (window.location.hash) requestAnimationFrame(() => document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'center' }));
      }).catch(error => { if (!controller.signal.aborted) setMessage(error.message); });
    return () => controller.abort();
  }, [applyData]);

  const onUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;

    if (!fileInput.files?.[0]) {
      setMessage("Please choose a .xls file.");
      return;
    }

    setLoading(true);
    setMessage("Uploading...");
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);

    const response = await fetch("/api/bank-statements/upload", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "Upload failed");
      setLoading(false);
      return;
    }

    setMessage("Upload complete.");
    form.reset();
    await loadData('');
    setLoading(false);
  };

  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-6 py-12 sm:px-10 lg:px-12">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Upload Bank Statements</h1>
        <p className="text-sm text-zinc-300">Upload monthly bank statement .xls files.</p>
        <Link href="/bank-statements/monthly" className="inline-block text-sm text-zinc-100 underline underline-offset-4">View monthly bank statements</Link>
      </header>

      <form onSubmit={onUpload} className="rounded-xl border border-zinc-700 bg-zinc-950 p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input name="file" type="file" accept=".xls" className="block text-sm text-zinc-100 file:mr-4 file:rounded-md file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-zinc-100" />
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-white disabled:opacity-60"
          >
            {loading ? "Uploading..." : "Upload Statement"}
          </button>
        </div>
        {message ? <p className="mt-3 text-sm text-zinc-100">{message}</p> : null}
      </form>

      {uploads.length ? <label className="block text-sm text-zinc-300">Statement to review<select value={selectedUpload} onChange={event => {
        void loadData(event.target.value).catch(error => setMessage(error.message));
      }} className="mt-2 block rounded border border-zinc-700 bg-zinc-900 p-2">
        {uploads.map(upload => <option key={upload.id} value={upload.id}>{upload.from} to {upload.to}</option>)}
      </select></label> : null}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card title="Statement Period" value={summary ? `${summary.statement_start_date} → ${summary.statement_end_date}` : "-"} />
        <Card title="Account Number" value={summary?.account_number ?? "-"} />
        <Card title="Transaction Count" value={summary ? String(summary.transaction_count) : "0"} />
        <Card title="Total Debit" value={summary?.total_debit ?? "0"} />
        <Card title="Total Credit" value={summary?.total_credit ?? "0"} />
        <Card title="Net Amount" value={summary?.net_amount ?? "0"} />
      </section>

      <section className="overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-zinc-800 text-sm text-zinc-100">
            <thead className="bg-zinc-900/80 text-xs uppercase text-zinc-300">
              <tr>
                <th className="px-4 py-3 text-left">Date</th>
                <th className="px-4 py-3 text-left">Value Date</th>
                <th className="px-4 py-3 text-left">Description</th>
                <th className="px-4 py-3 text-right">Debit</th>
                <th className="px-4 py-3 text-right">Credit</th>
                <th className="px-4 py-3 text-right">Running Balance</th>
                <th className="px-4 py-3 text-left">Reconciliation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {transactions.length === 0 ? (
                <tr>
                  <td className="px-4 py-5 text-zinc-300" colSpan={7}>No transactions uploaded yet.</td>
                </tr>
              ) : (
                transactions.map((tx, index) => (
                  <tr id={`payment-${tx.id}`} className="target:bg-amber-950/50" key={`${tx.transaction_date}-${index}`}>
                    <td className="px-4 py-3">{tx.transaction_date}</td>
                    <td className="px-4 py-3">{tx.value_date ?? ""}</td>
                    <td className="px-4 py-3">{[tx.description_1, tx.description_2].filter(Boolean).join(" ")}</td>
                    <td className="px-4 py-3 text-right">{tx.debit ?? ""}</td>
                    <td className="px-4 py-3 text-right">{tx.credit ?? ""}</td>
                    <td className="px-4 py-3 text-right">{tx.running_balance ?? ""}</td>
                    <td className="px-4 py-3">{Number(tx.credit) > 0 && ignoredBankCredit(tx.description_1, tx.description_2) ? <span className="text-zinc-400">Ignored</span> : Number(tx.credit) > 0 && /paynow/i.test([tx.description_1, tx.description_2].join(' ')) ? <>
                      <span className={tx.paynow_matched || tx.allocated_cents > 0 ? 'text-emerald-300' : 'text-zinc-400'}>{tx.paynow_matched ? 'PayNow matched' : tx.allocated_cents > 0 ? tx.remaining_cents === 0 ? 'Reconciled' : 'Partly reconciled' : 'Unreconciled'}</span>
                      <BankAllocationEditor transactionId={tx.id} allocations={tx.allocations} remainingCents={tx.remaining_cents} onChange={loadData} />
                    </> : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Link href="/" className="inline-block text-sm text-zinc-300 hover:text-zinc-100">
        ← Back to Dashboard
      </Link>
    </div>
  );
}

function Card({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-700 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-300">{title}</p>
      <p className="mt-1 text-lg font-semibold text-zinc-50">{value}</p>
    </div>
  );
}
