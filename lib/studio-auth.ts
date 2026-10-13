import 'server-only';
import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {sql} from '@/lib/db';

export const SESSION_COOKIE='__Host-studio_ops_session';
export const SESSION_SECONDS=8*60*60;
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
let tables:Promise<unknown>|undefined;
export async function ensureAuthTables() {
  if(!tables)tables=(async()=>{
    await sql`create table if not exists studio_auth_sessions (
      token_hash text primary key,username text not null,credential_version text not null,
      created_at timestamptz not null default now(),expires_at timestamptz not null)`;
    await sql`create table if not exists studio_auth_attempts (
      bucket text primary key,window_start timestamptz not null default now(),attempts integer not null default 1)`;
    await sql`create table if not exists studio_auth_accounts (
      username text primary key,password_hash text not null,updated_at timestamptz not null default now())`;
    const settings=config();
    if(settings)await sql`insert into studio_auth_accounts(username,password_hash) values(${settings.username},${settings.passwordHash}) on conflict(username) do nothing`;
  })().catch(error=>{tables=undefined;throw error;});
  await tables;
}
function config() {
  const username=process.env.STUDIO_AUTH_USERNAME,passwordHash=process.env.STUDIO_AUTH_PASSWORD_HASH;
  if(!username||!passwordHash||!/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(passwordHash))return null;
  return {username,passwordHash};
}
export function authConfigured() {return config()!==null;}
export function sessionToken(cookieHeader:string|null) {
  return cookieHeader?.split(';').map(part=>part.trim()).find(part=>part.startsWith(SESSION_COOKIE+'='))?.slice(SESSION_COOKIE.length+1)??null;
}
export async function getStudioSession(token:string|null) {
  const settings=config();
  if(!settings||!token||!/^[a-f0-9]{64}$/.test(token))return null;
  await ensureAuthTables();
  const rows=await sql<{username:string;credential_version:string;password_hash:string}[]>`select s.username,s.credential_version,a.password_hash from studio_auth_sessions s
    join studio_auth_accounts a on a.username=s.username where s.token_hash=${digest(token)} and s.username=${settings.username} and s.expires_at>now()`;
  const row=rows[0];return row&&row.credential_version===digest(row.password_hash)?{username:row.username}:null;
}
async function account() {
  const settings=config();if(!settings)return null;
  await ensureAuthTables();
  const rows=await sql<{username:string;password_hash:string}[]>`select username,password_hash from studio_auth_accounts where username=${settings.username}`;
  return rows[0]??null;
}
async function passwordKey(password:string,salt:string) {
  return new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,key)=>error?reject(error):resolve(key)));
}
export async function verifyStudioPassword(username:string,password:string) {
  const settings=await account();
  if(!settings||username.length>200||password.length>512)return false;
  const [,salt,expected]=settings.password_hash.split('$');
  const actual=await passwordKey(password,salt);
  const usernameMatch=timingSafeEqual(Buffer.from(digest(username)),Buffer.from(digest(settings.username)));
  return timingSafeEqual(actual,Buffer.from(expected,'hex'))&&usernameMatch;
}
export async function createStudioSession() {
  const settings=await account();if(!settings)throw new Error('Studio sign-in is unavailable.');
  await ensureAuthTables();
  await sql`delete from studio_auth_sessions where expires_at<=now()`;
  const token=randomBytes(32).toString('hex');
  await sql`insert into studio_auth_sessions(token_hash,username,credential_version,expires_at)
    values(${digest(token)},${settings.username},${digest(settings.password_hash)},now()+interval '8 hours')`;
  return token;
}
export async function changeStudioPassword(username:string,currentPassword:string,newPassword:string) {
  if(newPassword.length<15||newPassword.length>128)throw new Error('Use a new password of 15 to 128 characters. A passphrase is fine.');
  const settings=await account();
  if(!settings||username!==settings.username||!await verifyStudioPassword(username,currentPassword))throw new Error('The current password is incorrect.');
  if(currentPassword===newPassword)throw new Error('Choose a different password.');
  const salt=randomBytes(16).toString('hex'),newHash='scrypt$'+salt+'$'+(await passwordKey(newPassword,salt)).toString('hex');
  const token=randomBytes(32).toString('hex');
  await sql.begin(async tx=>{
    const changed=await tx`update studio_auth_accounts set password_hash=${newHash},updated_at=now() where username=${username} and password_hash=${settings.password_hash} returning username`;
    if(!changed.length)throw new Error('The current password changed. Sign in again.');
    await tx`delete from studio_auth_sessions where username=${username}`;
    await tx`insert into studio_auth_sessions(token_hash,username,credential_version,expires_at) values(${digest(token)},${username},${digest(newHash)},now()+interval '8 hours')`;
  });
  return token;
}
export async function revokeStudioSession(token:string|null) {
  if(!token||!/^[a-f0-9]{64}$/.test(token))return;
  await ensureAuthTables();await sql`delete from studio_auth_sessions where token_hash=${digest(token)}`;
}
export async function allowLoginAttempt(ip:string) {
  await ensureAuthTables();
  const settings=config();if(!settings)return false;
  const buckets=[`ip:${digest(settings.passwordHash+ip)}`,'account:admin'];
  const counts=await sql.begin(async tx=>{
    const results:number[]=[];
    for(const bucket of buckets) {
      const rows=await tx<{attempts:number}[]>`insert into studio_auth_attempts(bucket) values(${bucket})
        on conflict(bucket) do update set attempts=case when studio_auth_attempts.window_start<now()-interval '15 minutes' then 1 else studio_auth_attempts.attempts+1 end,
        window_start=case when studio_auth_attempts.window_start<now()-interval '15 minutes' then now() else studio_auth_attempts.window_start end returning attempts`;
      results.push(rows[0].attempts);
    }
    return results;
  });
  return counts[0]<=10&&counts[1]<=100;
}
export function safeLoginDestination(value:string|null) {
  if(!value||!value.startsWith('/')||value.startsWith('//')||/[\\\r\n]|%(?:2f|5c|0a|0d)/i.test(value)||value.startsWith('/login')||value.startsWith('/api/'))return '/';
  const url=new URL(value,'https://studio.invalid');return url.origin==='https://studio.invalid'?url.pathname+url.search:'/';
}
