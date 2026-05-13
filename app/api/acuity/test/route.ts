const ACUITY_APPOINTMENTS_URL = 'https://acuityscheduling.com/api/v1/appointments'

export async function GET() {
  const userId = process.env.ACUITY_USER_ID
  const apiKey = process.env.ACUITY_API_KEY

  if (!userId || !apiKey) {
    return Response.json(
      {
        success: false,
        status: 500,
        message: 'Missing ACUITY_USER_ID or ACUITY_API_KEY environment variables.',
      },
      { status: 500 },
    )
  }

  const authHeader = `Basic ${Buffer.from(`${userId}:${apiKey}`).toString('base64')}`
  const url = new URL(ACUITY_APPOINTMENTS_URL)
  url.searchParams.set('max', '1')

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
      },
      cache: 'no-store',
    })

    let payload: unknown = null

    try {
      payload = await response.json()
    } catch {
      payload = null
    }

    if (!response.ok) {
      const details =
        payload && typeof payload === 'object' && 'message' in payload
          ? String(payload.message)
          : `Acuity request failed with status ${response.status}.`

      return Response.json(
        {
          success: false,
          status: response.status,
          message: details,
        },
        { status: response.status },
      )
    }

    const appointments = Array.isArray(payload) ? payload : []

    return Response.json({
      success: true,
      status: response.status,
      message: 'Acuity credentials are valid.',
      sampleCount: appointments.length,
    })
  } catch (error) {
    return Response.json(
      {
        success: false,
        status: 502,
        message:
          error instanceof Error
            ? `Unable to reach Acuity API: ${error.message}`
            : 'Unable to reach Acuity API.',
      },
      { status: 502 },
    )
  }
}
