import 'server-only'

import { sql } from '@/lib/db'
import { formatYmd, syncAcuityAppointments } from '@/lib/acuity/sync'

export type ManualSyncStatus = 'running' | 'success' | 'failed'
export type ManualSyncStartResult =
  | { action: 'started'; run: ManualSyncRun }
  | { action: 'running'; run: ManualSyncRun; message: string }
  | { action: 'recent'; run: ManualSyncRun; message: string }

export type ManualSyncRun = {
  id: number
  status: ManualSyncStatus
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

type ManualSyncRunRow = {
  id: number
  status: ManualSyncStatus
  from_date: string | Date
  to_date: string | Date
  started_at: string | Date
  finished_at: string | Date | null
  message: string | null
  error_message: string | null
  records_fetched: number | string | null
  records_inserted: number | string | null
  records_updated: number | string | null
  records_skipped: number | string | null
  records_deleted: number | string | null
}

function dateOnly(value: string | Date): string {
  return value instanceof Date ? formatYmd(value) : String(value).slice(0, 10)
}

function isoOrNull(value: string | Date | null): string | null {
  if (!value) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function toRun(row: ManualSyncRunRow): ManualSyncRun {
  return {
    id: row.id,
    status: row.status,
    fromDate: dateOnly(row.from_date),
    toDate: dateOnly(row.to_date),
    startedAt: isoOrNull(row.started_at) ?? new Date().toISOString(),
    finishedAt: isoOrNull(row.finished_at),
    message: row.message,
    errorMessage: row.error_message,
    recordsFetched: Number(row.records_fetched ?? 0),
    recordsInserted: Number(row.records_inserted ?? 0),
    recordsUpdated: Number(row.records_updated ?? 0),
    recordsSkipped: Number(row.records_skipped ?? 0),
    recordsDeleted: Number(row.records_deleted ?? 0),
  }
}

export function getManualSyncWindow(today = new Date()): { from: Date; to: Date; fromYmd: string; toYmd: string } {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 3, 0))

  return { from, to, fromYmd: formatYmd(from), toYmd: formatYmd(to) }
}

function getMonthlyRanges(from: Date): { from: Date; to: Date }[] {
  return Array.from({ length: 4 }, (_, index) => {
    const monthStart = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + index, 1))
    const monthEnd = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 0))
    return { from: monthStart, to: monthEnd }
  })
}

export async function ensureManualSyncTable() {
  await sql`
    create table if not exists acuity_manual_sync_runs (
      id bigserial primary key,
      status text not null check (status in ('running', 'success', 'failed')),
      from_date date not null,
      to_date date not null,
      started_at timestamptz not null default now(),
      finished_at timestamptz,
      message text,
      error_message text,
      records_fetched integer not null default 0,
      records_inserted integer not null default 0,
      records_updated integer not null default 0,
      records_skipped integer not null default 0,
      records_deleted integer not null default 0
    )
  `

  await sql`
    create unique index if not exists acuity_manual_sync_runs_one_running
    on acuity_manual_sync_runs ((status))
    where status = 'running'
  `
}

export async function getLatestManualSyncRun(): Promise<ManualSyncRun | null> {
  await ensureManualSyncTable()
  const rows = await sql<ManualSyncRunRow[]>`
    select * from acuity_manual_sync_runs order by started_at desc limit 1
  `

  return rows[0] ? toRun(rows[0]) : null
}

export async function startManualSyncIfNeeded(): Promise<ManualSyncStartResult> {
  await ensureManualSyncTable()
  const window = getManualSyncWindow()

  const runningRows = await sql<ManualSyncRunRow[]>`
    select * from acuity_manual_sync_runs
    where status = 'running'
    order by started_at desc
    limit 1
  `

  if (runningRows[0]) {
    return { action: 'running', run: toRun(runningRows[0]), message: 'Acuity sync is already running.' }
  }

  const recentRows = await sql<ManualSyncRunRow[]>`
    select * from acuity_manual_sync_runs
    where status = 'success'
      and from_date = ${window.fromYmd}::date
      and to_date = ${window.toYmd}::date
      and finished_at >= now() - interval '30 minutes'
    order by finished_at desc
    limit 1
  `

  if (recentRows[0]) {
    return { action: 'recent', run: toRun(recentRows[0]), message: 'Already synced recently. No sync needed.' }
  }

  const insertedRows = await sql<ManualSyncRunRow[]>`
    insert into acuity_manual_sync_runs (status, from_date, to_date, message)
    values ('running', ${window.fromYmd}::date, ${window.toYmd}::date, 'Acuity sync is running.')
    returning *
  `

  return { action: 'started', run: toRun(insertedRows[0]) }
}

export async function runManualSync(runId: number) {
  const window = getManualSyncWindow()
  let totals = { recordsFetched: 0, recordsInserted: 0, recordsUpdated: 0, recordsSkipped: 0, recordsDeleted: 0 }

  try {
    for (const range of getMonthlyRanges(window.from)) {
      const result = await syncAcuityAppointments({ startDate: range.from, endDate: range.to })
      totals = {
        recordsFetched: totals.recordsFetched + result.recordsFetched,
        recordsInserted: totals.recordsInserted + result.recordsInserted,
        recordsUpdated: totals.recordsUpdated + result.recordsUpdated,
        recordsSkipped: totals.recordsSkipped + result.recordsSkipped,
        recordsDeleted: totals.recordsDeleted + result.recordsDeleted,
      }
    }

    await sql`
      update acuity_manual_sync_runs
      set status = 'success',
        finished_at = now(),
        message = 'Acuity sync completed.',
        error_message = null,
        records_fetched = ${totals.recordsFetched},
        records_inserted = ${totals.recordsInserted},
        records_updated = ${totals.recordsUpdated},
        records_skipped = ${totals.recordsSkipped},
        records_deleted = ${totals.recordsDeleted}
      where id = ${runId}
    `
  } catch (error) {
    await sql`
      update acuity_manual_sync_runs
      set status = 'failed',
        finished_at = now(),
        message = 'Acuity sync failed.',
        error_message = ${error instanceof Error ? error.message : 'Unknown sync error'}
      where id = ${runId}
    `
  }
}
