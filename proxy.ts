import {NextResponse,type NextRequest} from 'next/server';
import {getStudioSession,sessionToken} from '@/lib/studio-auth';
export async function proxy(request:NextRequest) {
  const path=request.nextUrl.pathname;
  const publicPath=path==='/login'||path==='/api/auth/login'||path==='/api/auth/logout'||path==='/favicon.ico';
  const forwarded=new Headers(request.headers);
  forwarded.set('x-studio-path',path+request.nextUrl.search);
  if(!publicPath) {
    let authenticated=false;
    try {authenticated=Boolean(await getStudioSession(sessionToken(request.headers.get('cookie'))));}catch{/* Fail closed when session storage is unavailable. */}
    if(!authenticated) {
      if(path.startsWith('/api/'))return NextResponse.json({error:'Sign in to Studio Ops.'},{status:401,headers:{'Cache-Control':'no-store'}});
      const login=new URL('/login',request.url);login.searchParams.set('next',path+request.nextUrl.search);
      const response=NextResponse.redirect(login);response.headers.set('Cache-Control','private, no-store');return response;
    }
  }
  const response=NextResponse.next({request:{headers:forwarded}});
  response.headers.set('Cache-Control','private, no-store');
  response.headers.set('X-Robots-Tag','noindex, nofollow, noarchive');
  response.headers.set('X-Content-Type-Options','nosniff');
  response.headers.set('Referrer-Policy','same-origin');
  response.headers.set('X-Frame-Options','DENY');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image).*)']};
