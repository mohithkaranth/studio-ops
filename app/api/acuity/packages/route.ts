import {authorizeApiRequest} from '@/lib/studio-auth-request';
import {getPackageSyncStatus, syncAcuityPackages} from '@/lib/acuity/packages';
export const maxDuration = 300;
export async function GET(request: Request) {
  const denied = await authorizeApiRequest(request,false); if (denied) return denied;
  return Response.json({status:await getPackageSyncStatus()});
}
export async function POST(request: Request) {
  const denied = await authorizeApiRequest(request,true); if (denied) return denied;
  try {return Response.json(await syncAcuityPackages());}
  catch (error) {return Response.json({error:error instanceof Error?error.message:'Unable to sync packages.'},{status:502});}
}
