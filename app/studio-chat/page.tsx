'use client';
import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';

type Message = { role:'user'|'assistant'; content:string; sources?:{label:string;href:string}[] };
const STORAGE_KEY = 'studio-chat-conversation-v2';
export default function StudioChatPage() {
  const [messages,setMessages] = useState<Message[]>([]);
  const [question,setQuestion] = useState('');
  const [loading,setLoading] = useState(false);
  const [ready,setReady] = useState(false);
  const [error,setError] = useState('');
  useEffect(()=>{
    Promise.resolve().then(()=>{
      try { const stored=JSON.parse(localStorage.getItem(STORAGE_KEY)??'[]'); if(Array.isArray(stored)) setMessages(stored.filter(item=>item && (item.role==='user'||item.role==='assistant') && typeof item.content==='string').slice(-24)); } catch { /* Start a fresh conversation if browser storage is unavailable. */ }
      setReady(true);
    });
  },[]);
  useEffect(()=>{ if(ready) { try { localStorage.setItem(STORAGE_KEY,JSON.stringify(messages.slice(-24))); } catch { /* Conversation still works without browser persistence. */ } } },[messages,ready]);
  async function ask(event:FormEvent) {
    event.preventDefault();
    const trimmed=question.trim(); if(!trimmed||loading) return;
    const history=messages.map(message=>({role:message.role,content:message.content}));
    setMessages(previous=>[...previous,{role:'user',content:trimmed}]); setQuestion(''); setLoading(true); setError('');
    try {
      const response=await fetch('/api/studio-chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:trimmed,history}),signal:AbortSignal.timeout(260000)});
      const result=await response.json(); if(!response.ok) throw new Error(result.error??'Studio Chat could not finish.');
      setMessages(previous=>[...previous,{role:'assistant',content:result.answer,sources:result.sources}]);
    } catch(issue) { setError(issue instanceof Error?issue.message:'The connection failed. Please retry.'); setQuestion(trimmed); }
    finally { setLoading(false); }
  }
  return <main className="min-h-screen w-full bg-zinc-950 text-zinc-100"><div className="mx-auto max-w-5xl space-y-6 px-6 py-10">
    <header className="flex items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold">Studio Chat</h1><p className="mt-2 text-sm text-zinc-400">Ask about bookings, bank payments or reconciliation. Follow-up questions stay in this conversation.</p></div><button disabled={loading||!ready} onClick={()=>{setMessages([]);setError('');setQuestion('');}} className="rounded border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50">New conversation</button></header>
    <div className="space-y-4" aria-live="polite">{messages.map((message,index)=><section key={index} className={`rounded-xl border p-5 ${message.role==='user'?'ml-8 border-zinc-700 bg-zinc-900':'mr-8 border-zinc-800 bg-zinc-900/40'}`}>
      <p className="mb-2 text-xs uppercase text-zinc-500">{message.role==='user'?'You':'Studio Chat'}</p><p className="whitespace-pre-wrap leading-relaxed">{message.content}</p>
      {message.sources?.length?<details className="mt-4 text-sm"><summary className="cursor-pointer text-zinc-400">View supporting records ({message.sources.length})</summary><ul className="mt-3 space-y-2">{message.sources.filter(source=>/^\/(acuity\/appointments\/\d+|bank-statements\?|reconciliation\/unsettled\?)/.test(source.href)).map(source=><li key={source.href}><Link className="underline underline-offset-4" href={source.href}>{source.label}</Link></li>)}</ul></details>:null}
    </section>)}</div>
    {loading?<p role="status" className="text-sm text-zinc-400">Checking studio records…</p>:null}
    {error?<p role="alert" className="text-red-300">{error}</p>:null}
    <form onSubmit={ask} className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><label htmlFor="studio-chat-question" className="text-sm">Your question</label><textarea id="studio-chat-question" rows={2} maxLength={4000} value={question} onChange={event=>setQuestion(event.target.value)} placeholder="How many payments did Chris Chuah make from January to September?" className="w-full rounded border border-zinc-700 bg-zinc-950 p-3 outline-none focus:border-zinc-400"/><button disabled={loading||!ready||!question.trim()} className="rounded bg-zinc-100 px-5 py-2 text-zinc-950 disabled:opacity-50">{loading?'Checking…':'Ask'}</button></form>
  </div></main>;
}
