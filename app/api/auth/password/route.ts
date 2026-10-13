import {NextResponse} from 'next/server';
import {authorizeApiRequest} from '@/lib/studio-auth-request';
import {getStudioSession,sessionToken,allowLoginAttempt,changeStudioPassword,SESSION_COOKIE,SESSION_SECONDS} from '@/lib/studio-auth';
export const runtime='nodejs';
export async function POST(request:Request) {
  const denied=await authorizeApiRequest(request,true);if(denied)return denied;
  try {
    const session=await getStudioSession(sessionToken(request.headers.get('cookie')));
    if(!session)return NextResponse.json({error:'Sign in to Studio Ops.'},{status:401});
    const ip=request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-forwarded-for')?.split(',')[0]??'unknown';
    if(!await allowLoginAttempt(ip))return NextResponse.json({error:'Too many attempts. Please try again in 15 minutes.'},{status:429});
    const body=await request.json();
    if(typeof body.currentPassword!=='string'||body.currentPassword.length>512||typeof body.newPassword!=='string'||body.newPassword!==body.confirmPassword)return NextResponse.json({error:'Check your current password and make sure the new passwords match.'},{status:400});
    const token=await changeStudioPassword(session.username,body.currentPassword,body.newPassword);
    const response=NextResponse.json({success:true},{headers:{'Cache-Control':'no-store'}});
    response.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:SESSION_SECONDS});return response;
  }catch(error) {
    const safe=error instanceof Error&&/^(Use a new password|The current password|Choose a different password)/.test(error.message);
    return NextResponse.json({error:safe?(error as Error).message:'Password change could not finish. Please retry.'},{status:400,headers:{'Cache-Control':'no-store'}});
  }
}
