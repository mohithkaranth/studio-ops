import 'server-only'

import { sql } from '@/lib/db'

const ACUITY_APPOINTMENTS_URL = 'https://acuityscheduling.com/api/v1/appointments'
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

type AcuityAppointment = {
  id?: number | string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  date?: string
  datetime?: string
  timezone?: string
  [key: string]: unknown
}

type SyncStatus = 'running' | 'success' | 'failed'

const hasOwn = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key)

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') {
    return null
  }

  const normalized = email.trim().toLowerCase()
  return normalized.length ? normalized : null
}

function parseDateParam(value: string | null): Date | null {
  if (!value || !DATE_ONLY_RE.test(value)) {
    return null
  }

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getCurrentMonthRange(): { from: Date; to: Date } {
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))

  return { from, to }
}

function eachUtcDay(from: Date, to: Date): string[] {
  const days: string[] = []
  const cursor = new Date(from)

  while (cursor <= to) {
    days.push(formatYmd(cursor))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return days
}

async function getTableColumns(tableName: string): Promise<Set<string>> {
  const rows = await sql<{ column_name: string }[]>`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = ${tableName}
  `

  return new Set(rows.map((row) => row.column_name))
}

async function createSyncRun(fromDate: string, toDate: string): Promise<number | null> {
  const columns = await getTableColumns('acuity_sync_runs')
  if (!columns.size) {
    return null
  }

  const payload: Record<string, unknown> = {}

  if (columns.has('status')) payload.status = 'running'
  if (columns.has('started_at')) payload.started_at = new Date().toISOString()
  if (columns.has('from_date')) payload.from_date = fromDate
  if (columns.has('to_date')) payload.to_date = toDate

  if (!Object.keys(payload).length) {
    return null
  }

  const [row] = await sql<{ id?: number }[]>`
    insert into acuity_sync_runs ${sql(payload)}
    returning id
  `

  return row?.id ?? null
}

async function updateSyncRun(runId: number | null, update: Record<string, unknown>) {
  if (!runId || !Object.keys(update).length) {
    return
  }

  await sql`
    update acuity_sync_runs
    set ${sql(update)}
    where id = ${runId}
  `
}

async function fetchAppointmentsForDay(day: string, authHeader: string): Promise<AcuityAppointment[]> {
  const url = new URL(ACUITY_APPOINTMENTS_URL)
  url.searchParams.set('minDate', day)
  url.searchParams.set('maxDate', day)
  url.searchParams.set('direction', 'ASC')
  url.searchParams.set('max', '100')

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && hasOwn(payload as Record<string, unknown>, 'message')
        ? String((payload as Record<string, unknown>).message)
        : `Acuity request failed for ${day} with status ${response.status}.`

    throw new Error(message)
  }

  return Array.isArray(payload) ? (payload as AcuityAppointment[]) : []
}

export async function GET(request: Request) {
  const userId = process.env.ACUITY_USER_ID
  const apiKey = process.env.ACUITY_API_KEY

  if (!userId || !apiKey) {
    return Response.json(
      {
        success: false,
        message: 'Missing ACUITY_USER_ID or ACUITY_API_KEY environment variables.',
      },
      { status: 500 },
    )
  }

  const url = new URL(request.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')

  const defaultRange = getCurrentMonthRange()
  const fromDate = parseDateParam(fromParam) ?? defaultRange.from
  const toDate = parseDateParam(toParam) ?? defaultRange.to

  if (fromDate > toDate) {
    return Response.json(
      {
        success: false,
        message: '`from` must be on or before `to`.',
      },
      { status: 400 },
    )
  }

  const fromYmd = formatYmd(fromDate)
  const toYmd = formatYmd(toDate)

  let runId: number | null = null

  try {
    runId = await createSyncRun(fromYmd, toYmd)

    const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`
    const days = eachUtcDay(fromDate, toDate)
    const merged = new Map<string, AcuityAppointment>()

    for (const day of days) {
      const dailyAppointments = await fetchAppointmentsForDay(day, authHeader)

      for (const appointment of dailyAppointments) {
        const appointmentId = appointment.id
        if (appointmentId === undefined || appointmentId === null) {
          continue
        }

        merged.set(String(appointmentId), appointment)
      }
    }

    const appointmentColumns = await getTableColumns('acuity_appointments')
    const clientColumns = await getTableColumns('acuity_clients')

    let appointmentsUpserted = 0
    let clientsUpserted = 0

    for (const [appointmentId, appointment] of merged.entries()) {
      const appointmentPayload: Record<string, unknown> = {}

      if (appointmentColumns.has('acuity_appointment_id')) {
        appointmentPayload.acuity_appointment_id = appointmentId
      }
      if (appointmentColumns.has('appointment_datetime') && typeof appointment.datetime === 'string') {
        appointmentPayload.appointment_datetime = appointment.datetime
      }
      if (appointmentColumns.has('appointment_date') && typeof appointment.date === 'string') {
        appointmentPayload.appointment_date = appointment.date
      }
      if (appointmentColumns.has('email')) {
        appointmentPayload.email = normalizeEmail(appointment.email)
      }
      if (appointmentColumns.has('first_name') && typeof appointment.firstName === 'string') {
        appointmentPayload.first_name = appointment.firstName
      }
      if (appointmentColumns.has('last_name') && typeof appointment.lastName === 'string') {
        appointmentPayload.last_name = appointment.lastName
      }
      if (appointmentColumns.has('phone') && typeof appointment.phone === 'string') {
        appointmentPayload.phone = appointment.phone
      }
      if (appointmentColumns.has('timezone') && typeof appointment.timezone === 'string') {
        appointmentPayload.timezone = appointment.timezone
      }
      if (appointmentColumns.has('raw_payload')) {
        appointmentPayload.raw_payload = appointment
      }
      if (appointmentColumns.has('updated_at')) {
        appointmentPayload.updated_at = new Date().toISOString()
      }

      if (appointmentColumns.has('acuity_appointment_id')) {
        await sql`
          insert into acuity_appointments ${sql(appointmentPayload)}
          on conflict (acuity_appointment_id) do update
          set ${sql(appointmentPayload)}
        `
        appointmentsUpserted += 1
      }

      const email = normalizeEmail(appointment.email)
      if (!email || !clientColumns.has('email')) {
        continue
      }

      const clientPayload: Record<string, unknown> = { email }

      if (clientColumns.has('first_name') && typeof appointment.firstName === 'string') {
        clientPayload.first_name = appointment.firstName
      }
      if (clientColumns.has('last_name') && typeof appointment.lastName === 'string') {
        clientPayload.last_name = appointment.lastName
      }
      if (clientColumns.has('phone') && typeof appointment.phone === 'string') {
        clientPayload.phone = appointment.phone
      }
      if (clientColumns.has('updated_at')) {
        clientPayload.updated_at = new Date().toISOString()
      }
      if (clientColumns.has('raw_payload')) {
        clientPayload.raw_payload = appointment
      }

      await sql`
        insert into acuity_clients ${sql(clientPayload)}
        on conflict (email) do update
        set ${sql(clientPayload)}
      `
      clientsUpserted += 1
    }

    const syncUpdate: Record<string, unknown> = {
      status: 'success' satisfies SyncStatus,
      finished_at: new Date().toISOString(),
      records_fetched: merged.size,
      records_upserted: appointmentsUpserted,
    }

    if ((await getTableColumns('acuity_sync_runs')).has('clients_upserted')) {
      syncUpdate.clients_upserted = clientsUpserted
    }

    await updateSyncRun(runId, syncUpdate)

    return Response.json({
      success: true,
      from: fromYmd,
      to: toYmd,
      recordsFetched: merged.size,
      appointmentsUpserted,
      clientsUpserted,
    })
  } catch (error) {
    await updateSyncRun(runId, {
      status: 'failed' satisfies SyncStatus,
      error_message: error instanceof Error ? error.message : 'Unknown sync error',
      finished_at: new Date().toISOString(),
    })

    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Appointment sync failed.',
      },
      { status: 500 },
    )
  }
}
