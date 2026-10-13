import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs} from './ts-loader.mjs';
const deny=async()=>Response.json({error:'Sign in to Studio Ops.'},{status:401});
const db={sql:()=>({then:()=>{throw new Error('Unauthenticated request reached the database');}})};
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(item=>item.isDirectory()?files(path.join(dir,item.name)):[path.join(dir,item.name)]);}
test('every studio API rejects unauthenticated callers before data reads or mutations',async()=>{
  for(const file of files('app/api').filter(file=>file.endsWith('route.ts')&&!file.includes(path.join('auth','login'))&&!file.includes(path.join('auth','logout')))) {
    const route=loadTs(file,{'@/lib/studio-auth-request':{authorizeApiRequest:deny},'@/lib/db':db,'server-only':{}});
    for(const method of ['GET','POST','DELETE'])if(route[method]) {
      const response=await route[method](new Request(`https://studio.example/${file.replaceAll('\\','/')}`,{method}));
      assert.equal(response.status,401,`${file} ${method}`);
    }
  }
});
test('every protected page and server action has its own session guard',()=>{
  const pageFiles=files('app').filter(file=>file.endsWith('page.tsx')&&!file.includes(path.join('app','login')));
  for(const file of pageFiles)assert.ok(fs.readFileSync(file,'utf8').includes('await requireStudioSession()'),file);
  const action=fs.readFileSync('app/acuity/dashboard/page.tsx','utf8');
  assert.ok(/['"]use server['"]\s*;?\s*await requireStudioSession\(\)/.test(action));
});
test('login destinations cannot redirect to external sites or authentication endpoints',()=>{
  const {safeLoginDestination}=loadTs('lib/studio-auth.ts',{'@/lib/db':db,'server-only':{}});
  for(const destination of ['https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/login','/api/auth/login'])assert.equal(safeLoginDestination(destination),'/');
  assert.equal(safeLoginDestination('/acuity/appointments/123?from=report'),'/acuity/appointments/123?from=report');
});
test('the request gate denies forged cookies and middleware/RSC bypass headers',async()=>{
  const {NextRequest}=await import('next/server.js');
  const {proxy}=loadTs('proxy.ts',{'@/lib/studio-auth':{getStudioSession:async()=>null,sessionToken:()=>null}});
  for(const pathname of ['/api/bank-statements/summary','/api/studio-chat','/api/auth/password','/acuity/appointments/123?_rsc=probe','/studio-chat']) {
    const response=await proxy(new NextRequest('https://studio.example'+pathname,{headers:{cookie:'__Host-studio_ops_session='+'f'.repeat(64),'x-middleware-subrequest':'proxy:proxy:proxy:proxy:proxy',rsc:'1'}}));
    if(pathname.startsWith('/api/'))assert.equal(response.status,401);else {assert.equal(response.status,307);assert.ok(response.headers.get('location').includes('/login?'));}
  }
});
