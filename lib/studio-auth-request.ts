import 'server-only';
import {cookies,headers} from 'next/headers';
import {redirect} from 'next/navigation';
import {getStudioSession,SESSION_COOKIE,sessionToken,safeLoginDestination} from './studio-auth';
export async function requireStudioSession() {
  const session=await getStudioSession((await cookies()).get(SESSION_COOKIE)?.value??null);
  if(!session)redirect(`/login?next=${encodeURIComponent(safeLoginDestination((await headers()).get('x-studio-path')))}`);
  return session;
}
export async function authorizeApiRequest(request?:Request,unsafe=false) {
  const h=request?.headers??await headers();
  if(h.get('sec-fetch-site')==='cross-site')return Response.json({error:'Open this action in Studio Ops.'},{status:403,headers:{'Cache-Control':'no-store'}});
  if(unsafe||request&&!['GET','HEAD','OPTIONS'].includes(request.method)) {
    const origin=request?new URL(request.url).origin:`${h.get('x-forwarded-proto')??'https'}://${h.get('host')}`;
    if(h.get('origin')!==origin)return Response.json({error:'Open this action in Studio Ops.'},{status:403,headers:{'Cache-Control':'no-store'}});
  }
  try {
    if(!await getStudioSession(sessionToken(h.get('cookie'))))return Response.json({error:'Sign in to Studio Ops.'},{status:401,headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Sign-in verification is unavailable. Please retry.'},{status:503,headers:{'Cache-Control':'no-store'}});}
  return null;
}
