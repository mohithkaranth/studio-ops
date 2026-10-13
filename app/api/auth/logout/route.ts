import {NextResponse} from 'next/server';
import {revokeStudioSession,sessionToken,SESSION_COOKIE} from '@/lib/studio-auth';
export const runtime='nodejs';
export async function POST(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin)return NextResponse.json({error:'Open Studio Ops to sign out.'},{status:403});
  try {await revokeStudioSession(sessionToken(request.headers.get('cookie')));}catch{return NextResponse.json({error:'Sign-out could not finish. Please retry.'},{status:503});}
  const response=NextResponse.redirect(new URL('/login',request.url),303);
  response.cookies.set(SESSION_COOKIE,'',{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:0});
  response.headers.set('Cache-Control','no-store');response.headers.set('Clear-Site-Data','"cache", "cookies", "storage"');return response;
}
