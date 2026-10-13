import {NextResponse} from 'next/server';
import {authConfigured,allowLoginAttempt,verifyStudioPassword,createStudioSession,safeLoginDestination,SESSION_COOKIE,SESSION_SECONDS} from '@/lib/studio-auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
function failure(request:Request,next:string,error:string) {
  const url=new URL('/login',request.url);url.searchParams.set('next',next);url.searchParams.set('error',error);
  const response=NextResponse.redirect(url,303);response.headers.set('Cache-Control','no-store');return response;
}
export async function POST(request:Request) {
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')return NextResponse.json({error:'Open Studio Ops to sign in.'},{status:403});
  if(Number(request.headers.get('content-length')??0)>4096)return NextResponse.json({error:'Sign-in request is too large.'},{status:413});
  let next='/';
  try {
    if(!authConfigured())return failure(request,next,'unavailable');
    if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return NextResponse.json({error:'Use the Studio Ops sign-in form.'},{status:415});
    const reader=request.body?.getReader(),chunks:Uint8Array[]=[];let length=0;
    if(reader)for(;;) {
      const part=await reader.read();if(part.done)break;
      length+=part.value.length;if(length>4096){await reader.cancel();return NextResponse.json({error:'Sign-in request is too large.'},{status:413});}
      chunks.push(part.value);
    }
    const body=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    const username=String(body.get('username')??''),password=String(body.get('password')??'');
    next=safeLoginDestination(String(body.get('next')??'/'));
    const ip=request.headers.get('x-vercel-forwarded-for')??request.headers.get('x-forwarded-for')?.split(',')[0]??'unknown';
    if(!await allowLoginAttempt(ip))return failure(request,next,'attempts');
    if(!await verifyStudioPassword(username,password))return failure(request,next,'invalid');
    const token=await createStudioSession();
    const response=NextResponse.redirect(new URL(next,request.url),303);
    response.cookies.set(SESSION_COOKIE,token,{httpOnly:true,secure:true,sameSite:'strict',path:'/',maxAge:SESSION_SECONDS});
    response.headers.set('Cache-Control','private, no-store');return response;
  }catch{return failure(request,next,'unavailable');}
}
