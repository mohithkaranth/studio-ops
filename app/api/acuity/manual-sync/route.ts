import {authorizeApiRequest} from '@/lib/studio-auth-request';
import 'server-only'

import { after } from 'next/server'

import { getLatestManualSyncRun, runManualSync, startManualSyncIfNeeded } from '@/lib/acuity/manual-sync'

export async function GET() {
  const denied=await authorizeApiRequest(undefined,false);if(denied)return denied;

  const run = await getLatestManualSyncRun()
  return Response.json({ run })
}

export async function POST() {
  const denied=await authorizeApiRequest(undefined,true);if(denied)return denied;

  try {
    const result = await startManualSyncIfNeeded()

    if (result.action === 'started') {
      after(async () => {
        await runManualSync(result.run.id)
      })
    }

    return Response.json(result)
  } catch (error) {
    return Response.json(
      {
        action: 'error',
        message: error instanceof Error ? error.message : 'Unable to start Acuity sync.',
      },
      { status: 500 },
    )
  }
}
