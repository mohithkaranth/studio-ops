'use client'

import { useEffect, useState } from 'react'

type ManualSyncRun = {
  id: number
  status: 'running' | 'success' | 'failed'
  fromDate: string
  toDate: string
  startedAt: string
  finishedAt: string | null
  message: string | null
  errorMessage: string | null
  recordsFetched: number
  recordsInserted: number
  recordsUpdated: number
  recordsSkipped: number
  recordsDeleted: number
}

type StartPayload = {
  action?: 'started' | 'running' | 'recent' | 'error'
  run?: ManualSyncRun
  message?: string
}

function statusLabel(status: ManualSyncRun['status']) {
  if (status === 'success') return 'Done'
  if (status === 'failed') return 'Failed'
  return 'Syncing'
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

export default function AcuitySyncForm() {
  const [run, setRun] = useState<ManualSyncRun | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const isSyncing = run?.status === 'running'

  async function loadStatus() {
    const response = await fetch('/api/acuity/manual-sync', { cache: 'no-store' })
    const payload = (await response.json().catch(() => null)) as { run?: ManualSyncRun | null } | null
    setRun(payload?.run ?? null)
  }

  useEffect(() => {
    let cancelled = false

    async function poll() {
      if (cancelled) return
      await loadStatus()
    }

    poll().catch(() => undefined)
    const interval = window.setInterval(() => {
      poll().catch(() => undefined)
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  const startSync = async () => {
    setNotice(null)
    setErrorMessage(null)

    try {
      const response = await fetch('/api/acuity/manual-sync', {
        method: 'POST',
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => null)) as StartPayload | null

      if (!response.ok || payload?.action === 'error') {
        throw new Error(payload?.message ?? 'Unable to start Acuity sync.')
      }

      setRun(payload?.run ?? null)
      if (payload?.action === 'recent') {
        setNotice(payload.message ?? 'Already synced recently. No sync needed.')
      } else if (payload?.action === 'running') {
        setNotice(payload.message ?? 'Acuity sync is already running.')
      } else {
        setNotice('Acuity sync started. You can leave this page and return later.')
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'An unknown sync error occurred.')
    }
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={startSync}
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
            {run ? (
              <tr>
                <td className="px-4 py-3 text-zinc-200">{run.fromDate}</td>
                <td className="px-4 py-3 text-zinc-200">{run.toDate}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded px-2 py-1 text-xs font-medium ${
                      run.status === 'success'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : run.status === 'failed'
                          ? 'bg-rose-500/20 text-rose-300'
                          : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {statusLabel(run.status)}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-300">
                  {run.errorMessage ? (
                    <span className="text-rose-300">{run.errorMessage}</span>
                  ) : (
                    <code className="block whitespace-pre-wrap break-words text-xs text-zinc-300">
                      {JSON.stringify({
                        startedAt: formatDateTime(run.startedAt),
                        finishedAt: formatDateTime(run.finishedAt),
                        recordsFetched: run.recordsFetched,
                        recordsInserted: run.recordsInserted,
                        recordsUpdated: run.recordsUpdated,
                        recordsSkipped: run.recordsSkipped,
                        recordsDeleted: run.recordsDeleted,
                      })}
                    </code>
                  )}
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-3 text-zinc-500">
                  No manual Acuity sync has been started yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {notice ? <p className="text-sm text-emerald-300">{notice}</p> : null}
      {errorMessage ? <p className="text-sm text-rose-300">Error: {errorMessage}</p> : null}
      <p className="text-xs text-zinc-500">
        Status is stored on the server. Next.js <code>after()</code> is used to continue the manual sync after the start request returns; on serverless platforms this remains subject to the route execution duration and platform background-work guarantees.
      </p>
    </div>
  )
}
