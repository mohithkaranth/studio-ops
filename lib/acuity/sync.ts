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
  datetimeCreated?: string
  dateCreated?: string
  canceled?: boolean | string | number
  canceledDateTime?: string
  price?: string | number
  paid?: string | boolean | number
  certificate?: string
  certificateCode?: string
  [key: string]: unknown
}

type SyncStatus = 'running' | 'success' | 'failed'

const hasOwn = (obj: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(obj, key)

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null

  const normalized = email.trim().toLowerCase()
  return normalized.length ? normalized : null
}

function normalizePhone(phone: unknown): string | null {
  if (typeof phone !== 'string') return null

  const normalized = phone.replace(/\s+/g, '').trim()
  return normalized.length ? normalized : null
}

export function parseDateParam(value: string | null): Date | null {
  if (!value || !DATE_ONLY_RE.test(value)) return null

  const parsed = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return null

  return parsed
}

export function formatYmd(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function getCurrentMonthRange(): { from: Date; to: Date } {
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
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'boolean') {
    return String(value)
  }

  return null
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

function asNumberString(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null

    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) return trimmed
  }

  return null
}

function getCertificateCode(appointment: AcuityAppointment): string | null {
  return asString(appointment.certificateCode) ?? asString(appointment.certificate)
}

function getCreatedDateTime(appointment: AcuityAppointment): string | null {
  return (
    asString(appointment.datetimeCreated) ??
    asString(appointment.created) ??
    asString(appointment.dateCreated) ??
    null
  )
}

function inferPackage(appointment: AcuityAppointment): {
  inferred: boolean
  reason: string | null
} {
  const certificateCode = getCertificateCode(appointment)

  if (certificateCode) {
    return {
      inferred: true,
      reason: 'Certificate/package code present on appointment.',
    }
  }

  const price = Number(asNumberString(appointment.price) ?? NaN)
  const paidStatus = asString(appointment.paid)?.toLowerCase() ?? null

  if (Number.isFinite(price) && price === 0 && (!paidStatus || paidStatus === 'false' || paidStatus === '0')) {
    return {
      inferred: true,
      reason: 'Zero price and not marked paid.',
    }
  }

  return {
    inferred: false,
    reason: null,
  }
}

async function createSyncRun(fromDate: string, toDate: string): Promise<number> {
  const rows = await sql`
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
      now(),
      ${fromDate},
      ${toDate},
      0,
      0,
      0,
      null
    )
    returning id
  `

  const row = rows[0] as { id: number } | undefined

  if (!row) {
    throw new Error('Failed to create Acuity sync run.')
  }

  return row.id
}

async function updateSyncRun(
  runId: number,
  update: {
    status: SyncStatus
    recordsFetched?: number
    recordsInserted?: number
    recordsUpdated?: number
    recordsSkipped?: number
    errorMessage?: string | null
  },
) {
  const columnRows = await sql`
    select exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'acuity_sync_runs'
        and column_name = 'records_skipped'
    ) as has_records_skipped
  `

  const columnInfo = columnRows[0] as { has_records_skipped: boolean } | undefined

  if (columnInfo?.has_records_skipped) {
    await sql`
      update acuity_sync_runs
      set
        status = ${update.status},
        finished_at = now(),
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
      finished_at = now(),
      records_fetched = coalesce(${update.recordsFetched ?? null}, records_fetched),
      records_inserted = coalesce(${update.recordsInserted ?? null}, records_inserted),
      records_updated = coalesce(${update.recordsUpdated ?? null}, records_updated),
      error_message = ${update.errorMessage ?? null}
    where id = ${runId}
  `
}

async function fetchAppointmentsForDay(
  day: string,
  authHeader: string,
): Promise<{ appointments: AcuityAppointment[]; isValidArray: boolean }> {
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

  if (!Array.isArray(payload)) {
    return { appointments: [], isValidArray: false }
  }

  return { appointments: payload as AcuityAppointment[], isValidArray: true }
}


export type AcuitySyncResult = {
  success: true
  from: string
  to: string
  recordsFetched: number
  recordsInserted: number
  recordsUpdated: number
  recordsSkipped: number
  recordsDeleted: number
}

export async function syncAcuityAppointments({
  startDate,
  endDate,
}: {
  startDate: Date
  endDate: Date
}): Promise<AcuitySyncResult> {
  const userId = process.env.ACUITY_USER_ID
  const apiKey = process.env.ACUITY_API_KEY

  if (!userId || !apiKey) {
    throw new Error('Missing ACUITY_USER_ID or ACUITY_API_KEY environment variables.')
  }

  if (startDate > endDate) {
    throw new Error('`from` must be on or before `to`.')
  }

  const fromYmd = formatYmd(startDate)
  const toYmd = formatYmd(endDate)

  let runId: number | null = null

  try {
    runId = await createSyncRun(fromYmd, toYmd)

    const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`
    const days = eachUtcDay(startDate, endDate)
    const merged = new Map<string, AcuityAppointment>()
    const returnedAppointmentIds = new Set<string>()

    let recordsFetched = 0
    let recordsSkipped = 0
    let canDeleteStaleRows = true

    for (const day of days) {
      const { appointments: dailyAppointments, isValidArray } = await fetchAppointmentsForDay(day, authHeader)
      if (!isValidArray) {
        canDeleteStaleRows = false
      }
      recordsFetched += dailyAppointments.length

      for (const appointment of dailyAppointments) {
        const appointmentId = appointment.id

        if (appointmentId === undefined || appointmentId === null) {
          recordsSkipped += 1
          continue
        }

        const normalizedAppointmentId = String(appointmentId)
        returnedAppointmentIds.add(normalizedAppointmentId)
        merged.set(normalizedAppointmentId, appointment)
      }
    }

    let recordsInserted = 0
    let recordsUpdated = 0
    let recordsDeleted = 0

    for (const [appointmentId, appointment] of merged.entries()) {
      const appointmentJson = JSON.stringify(appointment)

      const normalizedEmail = normalizeEmail(appointment.email)
      const clientFirstName = asString(appointment.firstName)
      const clientLastName = asString(appointment.lastName)
      const clientPhone = asString(appointment.phone)
      const normalizedPhone = normalizePhone(appointment.phone)
      const certificateCode = getCertificateCode(appointment)
      const packageInfo = inferPackage(appointment)

      let clientId: number | null = null

      if (normalizedEmail) {
        const clientRows = await sql`
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
            ${normalizedPhone},
            now(),
            now(),
            ${appointmentJson}::jsonb,
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

        const clientRow = clientRows[0] as { id: number } | undefined

        if (!clientRow) {
          throw new Error('Client upsert failed.')
        }

        clientId = clientRow.id
      }

      const appointmentRows = await sql`
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
          ${getCreatedDateTime(appointment)},
          ${asBoolean(appointment.canceled)},
          ${asString(appointment.canceledDateTime)},
          ${asNumberString(appointment.price)},
          ${asString(appointment.paid)},
          ${certificateCode},
          ${packageInfo.inferred},
          ${packageInfo.reason},
          ${appointmentJson}::jsonb,
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

      const appointmentResult = appointmentRows[0] as { inserted: boolean } | undefined

      if (appointmentResult?.inserted) {
        recordsInserted += 1
      } else {
        recordsUpdated += 1
      }
    }

    if (canDeleteStaleRows) {
      const toExclusive = new Date(endDate)
      toExclusive.setUTCDate(toExclusive.getUTCDate() + 1)
      const toExclusiveYmd = formatYmd(toExclusive)
      const returnedIds = Array.from(returnedAppointmentIds)

      if (returnedIds.length === 0) {
        const deleteRows = await sql`
          delete from acuity_appointments
          where appointment_datetime >= ${fromYmd}::timestamp
            and appointment_datetime < ${toExclusiveYmd}::timestamp
          returning acuity_appointment_id
        `
        recordsDeleted = deleteRows.length
      } else {
        const deleteRows = await sql`
          delete from acuity_appointments
          where appointment_datetime >= ${fromYmd}::timestamp
            and appointment_datetime < ${toExclusiveYmd}::timestamp
            and not (acuity_appointment_id = any(${returnedIds}::text[]))
          returning acuity_appointment_id
        `
        recordsDeleted = deleteRows.length
      }
    }

    await updateSyncRun(runId, {
      status: 'success',
      recordsFetched,
      recordsInserted,
      recordsUpdated,
      recordsSkipped,
      errorMessage: null,
    })

    return {
      success: true,
      from: fromYmd,
      to: toYmd,
      recordsFetched,
      recordsInserted,
      recordsUpdated,
      recordsSkipped,
      recordsDeleted,
    }
  } catch (error) {
    if (runId !== null) {
      await updateSyncRun(runId, {
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown sync error',
      })
    }

    throw error
  }
}
