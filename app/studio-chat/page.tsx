"use client";

import { FormEvent, useState } from "react";

type SqlDebugInfo = { sql: string; params: (string | number)[] };

type ChatResponse =
  | { type: "clarification"; question: string; options?: string[] }
  | { type: "answer"; answer: string; columns: string[]; rows: Record<string, unknown>[]; sqlDebug?: SqlDebugInfo[]; semanticQuery?: unknown };

export default function StudioChatPage() {
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<ChatResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function ask(nextQuestion = question) {
    const trimmed = nextQuestion.trim();
    if (!trimmed) return;
    setLoading(true);
    setError("");
    setResponse(null);

    const res = await fetch("/api/studio-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: trimmed }),
    });
    const data = await res.json();
    if (!res.ok) setError(data.error ?? "Studio Chat failed.");
    else setResponse(data);
    setLoading(false);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void ask();
  }

  function clearChat() {
    setQuestion("");
    setResponse(null);
    setLoading(false);
    setError("");
  }

  return (
    <main className="min-h-screen w-full bg-zinc-950 text-zinc-100">
      <div className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10 sm:px-8 lg:px-10">
        <header className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">Studio Chat V1</p>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-50">Ask Studio Ops</h1>
          <p className="max-w-3xl text-sm text-zinc-400">
            Ask controlled questions about bank credits, bank debits, Acuity booking counts, room types, and monthly side-by-side summaries.
          </p>
        </header>

        <form onSubmit={onSubmit} className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-sm">
          <label htmlFor="studio-chat-question" className="text-sm font-medium text-zinc-200">Question</label>
          <div className="mt-3 flex flex-col gap-3 sm:flex-row">
            <input
              id="studio-chat-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="How much credits have happened from Stripe?"
              className="min-h-11 flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-4 text-sm text-zinc-100 outline-none ring-0 placeholder:text-zinc-600 focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={loading || !question.trim()}
              className="rounded-lg bg-zinc-100 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Asking..." : "Ask"}
            </button>
            <button
              type="button"
              onClick={clearChat}
              className="rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
            >
              Clear
            </button>
          </div>
        </form>

        {error ? <div className="rounded-xl border border-red-900/60 bg-red-950/40 p-4 text-sm text-red-200">{error}</div> : null}

        {response?.type === "clarification" ? (
          <section className="rounded-2xl border border-amber-900/60 bg-amber-950/20 p-5">
            <h2 className="text-lg font-semibold text-amber-100">Clarification needed</h2>
            <p className="mt-2 text-sm text-amber-50/90">{response.question}</p>
            {response.options?.length ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {response.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      const next = `${question} (${option})`;
                      setQuestion(next);
                      void ask(next);
                    }}
                    className="rounded-full border border-amber-700/70 px-3 py-1.5 text-sm text-amber-50 hover:bg-amber-900/40"
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        {response?.type === "answer" ? (
          <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
            <div>
              <h2 className="text-lg font-semibold text-zinc-50">Answer</h2>
              <p className="mt-2 text-sm text-zinc-300">{response.answer}</p>
            </div>
            {response.sqlDebug?.length ? (
              <button
                type="button"
                onClick={() => openGeneratedSql(response.sqlDebug ?? [], response.semanticQuery)}
                className="text-left text-xs font-medium text-zinc-400 underline underline-offset-4 hover:text-zinc-100"
              >
                View generated SQL
              </button>
            ) : null}
            <div className="overflow-x-auto rounded-xl border border-zinc-800">
              <table className="min-w-full divide-y divide-zinc-800 text-sm">
                <thead className="bg-zinc-950/80 text-xs uppercase tracking-wide text-zinc-500">
                  <tr>{response.columns.map((column) => <th key={column} className="px-4 py-3 text-left">{column}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-zinc-800 text-zinc-200">
                  {response.rows.length ? response.rows.map((row, index) => (
                    <tr key={index}>{response.columns.map((column) => <td key={column} className="whitespace-nowrap px-4 py-3">{formatCell(row[column])}</td>)}</tr>
                  )) : <tr><td colSpan={response.columns.length} className="px-4 py-5 text-zinc-500">No rows returned.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function formatCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function openGeneratedSql(sqlDebug: SqlDebugInfo[], semanticQuery: unknown) {
  const debugWindow = window.open("", "_blank");
  if (!debugWindow) return;

  debugWindow.document.write(`<!doctype html>
<html>
<head>
  <title>Studio Chat generated SQL</title>
  <style>
    body { background: #09090b; color: #e4e4e7; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 32px; }
    main { max-width: 960px; margin: 0 auto; }
    h1 { font-size: 24px; margin: 0 0 24px; }
    h2 { color: #fafafa; font-size: 16px; margin: 24px 0 8px; }
    pre { background: #18181b; border: 1px solid #3f3f46; border-radius: 12px; overflow-x: auto; padding: 16px; white-space: pre-wrap; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 13px; }
  </style>
</head>
<body>
  <main>
    <h1>Studio Chat generated SQL</h1>
    ${sqlDebug.map((debug, index) => `
      <section>
        <h2>Query ${index + 1}</h2>
        <pre><code>${escapeHtml(debug.sql)}</code></pre>
        <h2>Bound parameters</h2>
        <pre><code>${escapeHtml(JSON.stringify(debug.params, null, 2))}</code></pre>
      </section>
    `).join("")}
    ${semanticQuery === undefined ? "" : `
      <section>
        <h2>Resolved semantic query</h2>
        <pre><code>${escapeHtml(JSON.stringify(semanticQuery, null, 2))}</code></pre>
      </section>
    `}
  </main>
</body>
</html>`);
  debugWindow.document.close();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
