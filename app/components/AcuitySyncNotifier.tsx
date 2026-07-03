'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

type ManualSyncRun = {
  id: number
  status: 'running' | 'success' | 'failed'
  finishedAt: string | null
}

export default function AcuitySyncNotifier() {
  const router = useRouter()
  const [message, setMessage] = useState<string | null>(null)
  const watchedRunId = useRef<number | null>(null)
  const notifiedRunId = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false

    async function poll() {
      const response = await fetch('/api/acuity/manual-sync', { cache: 'no-store' })
      const payload = (await response.json().catch(() => null)) as { run?: ManualSyncRun | null } | null
      const run = payload?.run

      if (cancelled || !run) return

      if (run.status === 'running') {
        watchedRunId.current = run.id
        return
      }

      if (watchedRunId.current === run.id && notifiedRunId.current !== run.id) {
        notifiedRunId.current = run.id
        setMessage(run.status === 'success' ? 'Acuity sync completed' : 'Acuity sync failed')
        router.refresh()
        window.setTimeout(() => setMessage(null), 6000)
      }
    }

    poll().catch(() => undefined)
    const interval = window.setInterval(() => {
      poll().catch(() => undefined)
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [router])

  if (!message) return null

  return (
    <div className="fixed right-4 top-4 z-50 rounded-md border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 shadow-lg">
      {message}
    </div>
  )
}
