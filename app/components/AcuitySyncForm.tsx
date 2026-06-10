'use client'

import { useMemo, useState } from 'react'

type RowStatus = 'Pending' | 'Syncing' | 'Done' | 'Failed'

type SyncResult = {
  success?: boolean
  from?: string
  to?: string
  recordsFetched?: number
  recordsInserted?: number
  recordsUpdated?: number
  recordsSkipped?: number
  message?: string
}

type SyncRow = {
  id: string
  from: string
  to: string
  status: RowStatus
  result: SyncResult | null
  error: string | null
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function buildPreviousCurrentAndNextTwoMonths(today: Date): SyncRow[] {
  const ranges: SyncRow[] = []

  const startMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
  )

  for (let index = 0; index < 4; index += 1) {
    const monthStart = new Date(
      Date.UTC(
        startMonth.getUTCFullYear(),
        startMonth.getUTCMonth() + index,
        1,
      ),
    )

    const monthEnd = new Date(
      Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0),
    )

    ranges.push({
      id: `${formatYmd(monthStart)}_${formatYmd(monthEnd)}`,
      from: formatYmd(monthStart),
      to: formatYmd(monthEnd),
      status: 'Pending',
      result: null,
      error: null,
    })
  }

  return ranges
}

export default function AcuitySyncForm() {
  const initialRows = useMemo(() => buildPreviousCurrentAndNextTwoMonths(new Date()), [])
  const [rows, setRows] = useState<SyncRow[]>(initialRows)
  const [isSyncing, setIsSyncing] = useState(false)
  const [finalMessage, setFinalMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const syncPreviousCurrentAndNextTwoMonths = async () => {
    setIsSyncing(true)
    setFinalMessage(null)
    setErrorMessage(null)
    setRows((prev) =>
      prev.map((row) => ({
        ...row,
        status: 'Pending',
        result: null,
        error: null,
      })),
    )

    try {
      for (let i = 0; i < initialRows.length; i += 1) {
        const range = initialRows[i]

        setRows((prev) =>
          prev.map((row, index) =>
            index === i ? { ...row, status: 'Syncing', error: null } : row,
          ),
        )

        const response = await fetch(`/api/acuity/sync?from=${range.from}&to=${range.to}`, {
          method: 'GET',
          cache: 'no-store',
        })

        const payload = (await response.json().catch(() => null)) as SyncResult | null

        if (!response.ok || !payload?.success) {
          const message = payload?.message ?? `Sync failed for ${range.from} to ${range.to}.`

          setRows((prev) =>
            prev.map((row, index) =>
              index === i
                ? { ...row, status: 'Failed', error: message, result: payload }
                : row,
            ),
          )

          throw new Error(message)
        }

        setRows((prev) =>
          prev.map((row, index) =>
            index === i
              ? { ...row, status: 'Done', result: payload, error: null }
              : row,
          ),
        )
      }

      setFinalMessage('Success: previous month, current month, and next 2 months synced.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'An unknown sync error occurred.')
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={syncPreviousCurrentAndNextTwoMonths}
        disabled={isSyncing}
        className="inline-flex items-center rounded-md border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSyncing ? 'Syncing...' : 'Sync Previous, Current & Next 2 Months'}
      </button>

      <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/50">
        <table className="min-w-full divide-y divide-zinc-800 text-sm">
          <thead className="bg-zinc-900">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-zinc-300">From</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-300">To</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-300">Status</th>
              <th className="px-4 py-3 text-left font-medium text-zinc-300">Result</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 text-zinc-200">{row.from}</td>
                <td className="px-4 py-3 text-zinc-200">{row.to}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded px-2 py-1 text-xs font-medium ${
                      row.status === 'Done'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : row.status === 'Failed'
                          ? 'bg-rose-500/20 text-rose-300'
                          : row.status === 'Syncing'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-zinc-700/40 text-zinc-300'
                    }`}
                  >
                    {row.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {row.error ? (
                    <span className="text-rose-300">{row.error}</span>
                  ) : row.result ? (
                    <code className="block whitespace-pre-wrap break-words text-xs text-zinc-300">
                      {JSON.stringify(row.result)}
                    </code>
                  ) : (
                    <span className="text-zinc-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {finalMessage ? <p className="text-sm text-emerald-300">{finalMessage}</p> : null}
      {errorMessage ? <p className="text-sm text-rose-300">Error: {errorMessage}</p> : null}
    </div>
  )
}