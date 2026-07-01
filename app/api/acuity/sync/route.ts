import 'server-only'

import {
  getCurrentMonthRange,
  parseDateParam,
  syncAcuityAppointments,
} from '@/lib/acuity/sync'

export async function GET(request: Request) {
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

  try {
    const result = await syncAcuityAppointments({ startDate: fromDate, endDate: toDate })

    return Response.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Appointment sync failed.'

    return Response.json(
      {
        success: false,
        message,
      },
      { status: 500 },
    )
  }
}
