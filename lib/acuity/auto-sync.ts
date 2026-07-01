import 'server-only'

import { formatYmd, syncAcuityAppointments } from '@/lib/acuity/sync'

const AUTO_SYNC_THROTTLE_MS = 5 * 60 * 1000

let lastAutoSyncAttemptAt = 0

function getLastMonthRange(): { startDate: Date; endDate: Date } {
  const now = new Date()
  const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const startDate = new Date(endDate)
  startDate.setUTCMonth(startDate.getUTCMonth() - 1)

  return { startDate, endDate }
}

export async function tryAutoSyncAcuityAppointmentsOnAppOpen() {
  const now = Date.now()

  if (now - lastAutoSyncAttemptAt < AUTO_SYNC_THROTTLE_MS) {
    return
  }

  lastAutoSyncAttemptAt = now

  const { startDate, endDate } = getLastMonthRange()
  const from = formatYmd(startDate)
  const to = formatYmd(endDate)

  console.log(`[Acuity auto-sync] Starting app-open sync for ${from} through ${to}.`)

  try {
    const result = await syncAcuityAppointments({ startDate, endDate })
    console.log(
      `[Acuity auto-sync] Completed app-open sync for ${result.from} through ${result.to}: fetched=${result.recordsFetched}, inserted=${result.recordsInserted}, updated=${result.recordsUpdated}, skipped=${result.recordsSkipped}, deleted=${result.recordsDeleted}.`,
    )
  } catch (error) {
    console.error('[Acuity auto-sync] App-open sync failed.', error)
  }
}
