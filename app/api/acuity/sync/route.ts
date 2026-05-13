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
  appointmentTypeID?: number | string
  type?: string
  calendarID?: number | string
  calendar?: string
  created?: string
  canceled?: boolean | string | number
  canceledDateTime?: string
  price?: string | number
  paid?: string
  certificate?: string
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

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function asBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (!normalized) return false
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false
    return true
  }
  return false
}

function inferPackage(appointment: AcuityAppointment): { inferred: string | null; reason: string } {
  const typeName = asString(appointment.type)
  if (!typeName) {
    return { inferred: null, reason: 'No appointment type name provided.' }
  }

  return {
    inferred: typeName,
    reason: 'Derived from appointment type name.',
  }
}

async function createSyncRun(fromDate: string, toDate: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    insert into acuity_sync_runs (
      status,
      started_at,
      from_date,
      to_date,
      records_fetched,
      records_inserted,
      records_updated,
      error_message
    ) values (
      ${'running' satisfies SyncStatus},
      ${new Date().toISOString()},
      ${fromDate},
      ${toDate},
      0,
      0,
      0,
      null
    )
    returning id
  `

  return row.id
}

async function updateSyncRun(runId: number, update: {
  status: SyncStatus
  finishedAt?: string
  recordsFetched?: number
  recordsInserted?: number
  recordsUpdated?: number
  recordsSkipped?: number
  errorMessage?: string | null
}) {
  const [columnInfo] = await sql<{ has_records_skipped: boolean }[]>`
    select exists (
      select 1
      from information_schema.columns
      where table_name = 'acuity_sync_runs'
        and column_name = 'records_skipped'
    ) as has_records_skipped
  `

  if (columnInfo?.has_records_skipped) {
    await sql`
      update acuity_sync_runs
      set
        status = ${update.status},
        finished_at = coalesce(${update.finishedAt ?? null}, finished_at),
        records_fetched = coalesce(${update.recordsFetched ?? null}, records_fetched),
        records_inserted = coalesce(${update.recordsInserted ?? null}, records_inserted),
        records_updated = coalesce(${update.recordsUpdated ?? null}, records_updated),
        records_skipped = coalesce(${update.recordsSkipped ?? null}, records_skipped),
        error_message = ${update.errorMessage ?? null}
      where id = ${runId}
    `
    return
  }

  await sql`
    update acuity_sync_runs
    set
      status = ${update.status},
      finished_at = coalesce(${update.finishedAt ?? null}, finished_at),
      records_fetched = coalesce(${update.recordsFetched ?? null}, records_fetched),
      records_inserted = coalesce(${update.recordsInserted ?? null}, records_inserted),
      records_updated = coalesce(${update.recordsUpdated ?? null}, records_updated),
      error_message = ${update.errorMessage ?? null}
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
    let recordsFetched = 0
    let recordsSkipped = 0

    for (const day of days) {
      const dailyAppointments = await fetchAppointmentsForDay(day, authHeader)
      recordsFetched += dailyAppointments.length

      for (const appointment of dailyAppointments) {
        const appointmentId = appointment.id
        if (appointmentId === undefined || appointmentId === null) {
          recordsSkipped += 1
          continue
        }

        merged.set(String(appointmentId), appointment)
      }
    }

    let recordsInserted = 0
    let recordsUpdated = 0

    for (const [appointmentId, appointment] of merged.entries()) {
      const normalizedEmail = normalizeEmail(appointment.email)
      const clientFirstName = asString(appointment.firstName)
      const clientLastName = asString(appointment.lastName)
      const clientPhone = asString(appointment.phone)
      let clientId: number | null = null

      if (normalizedEmail) {
        const [clientRow] = await sql<{ id: number }[]>`
          insert into acuity_clients (
            acuity_client_id,
            first_name,
            last_name,
            email,
            phone,
            normalized_email,
            normalized_phone,
            first_seen_at,
            last_seen_at,
            raw_json,
            updated_at
          ) values (
            null,
            ${clientFirstName},
            ${clientLastName},
            ${normalizedEmail},
            ${clientPhone},
            ${normalizedEmail},
            ${clientPhone},
            now(),
            now(),
            ${appointment},
            now()
          )
          on conflict (normalized_email) do update
          set
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            email = excluded.email,
            phone = excluded.phone,
            normalized_phone = excluded.normalized_phone,
            last_seen_at = now(),
            raw_json = excluded.raw_json,
            updated_at = now()
          returning id
        `

        clientId = clientRow.id
      }

      const packageInfo = inferPackage(appointment)
      const [appointmentResult] = await sql<{ inserted: boolean }[]>`
        insert into acuity_appointments (
          acuity_appointment_id,
          client_id,
          client_email,
          client_phone,
          client_first_name,
          client_last_name,
          appointment_type_id,
          appointment_type_name,
          calendar_id,
          calendar_name,
          appointment_datetime,
          created_datetime,
          canceled,
          canceled_datetime,
          price,
          paid_status,
          certificate_code,
          package_inferred,
          package_inference_reason,
          raw_json,
          synced_at,
          updated_at
        ) values (
          ${appointmentId},
          ${clientId},
          ${normalizedEmail},
          ${clientPhone},
          ${clientFirstName},
          ${clientLastName},
          ${asInteger(appointment.appointmentTypeID)},
          ${asString(appointment.type)},
          ${asInteger(appointment.calendarID)},
          ${asString(appointment.calendar)},
          ${asString(appointment.datetime)},
          ${asString(appointment.created)},
          ${asBoolean(appointment.canceled)},
          ${asString(appointment.canceledDateTime)},
          ${asString(appointment.price)},
          ${asString(appointment.paid)},
          ${asString(appointment.certificate)},
          ${packageInfo.inferred},
          ${packageInfo.reason},
          ${appointment},
          now(),
          now()
        )
        on conflict (acuity_appointment_id) do update
        set
          client_id = excluded.client_id,
          client_email = excluded.client_email,
          client_phone = excluded.client_phone,
          client_first_name = excluded.client_first_name,
          client_last_name = excluded.client_last_name,
          appointment_type_id = excluded.appointment_type_id,
          appointment_type_name = excluded.appointment_type_name,
          calendar_id = excluded.calendar_id,
          calendar_name = excluded.calendar_name,
          appointment_datetime = excluded.appointment_datetime,
          created_datetime = excluded.created_datetime,
          canceled = excluded.canceled,
          canceled_datetime = excluded.canceled_datetime,
          price = excluded.price,
          paid_status = excluded.paid_status,
          certificate_code = excluded.certificate_code,
          package_inferred = excluded.package_inferred,
          package_inference_reason = excluded.package_inference_reason,
          raw_json = excluded.raw_json,
          synced_at = now(),
          updated_at = now()
        returning (xmax = 0) as inserted
      `

      if (appointmentResult?.inserted) {
        recordsInserted += 1
      } else {
        recordsUpdated += 1
      }
    }

    await updateSyncRun(runId, {
      status: 'success',
      finishedAt: new Date().toISOString(),
      recordsFetched,
      recordsInserted,
      recordsUpdated,
      recordsSkipped,
      errorMessage: null,
    })

    return Response.json({
      success: true,
      from: fromYmd,
      to: toYmd,
      recordsFetched,
      recordsInserted,
      recordsUpdated,
      recordsSkipped,
    })
  } catch (error) {
    if (runId !== null) {
      await updateSyncRun(runId, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        errorMessage: error instanceof Error ? error.message : 'Unknown sync error',
      })
    }

    return Response.json(
      {
        success: false,
        message: error instanceof Error ? error.message : 'Appointment sync failed.',
      },
      { status: 500 },
    )
  }
}
