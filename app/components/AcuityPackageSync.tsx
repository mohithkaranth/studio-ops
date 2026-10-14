'use client';
import {useState} from 'react';
export default function AcuityPackageSync() {
  const [busy,setBusy]=useState(false), [notice,setNotice]=useState('');
  async function sync() {
    setBusy(true); setNotice('');
    try {
      const response=await fetch('/api/acuity/packages',{method:'POST'});
      const result=await response.json();
      if (!response.ok) throw new Error(result.error||'Unable to sync packages.');
      setNotice(`Saved ${result.products} products, ${result.orders} orders and ${result.certificates} codes. Studio Chat can look them up.`);
    } catch(error) {setNotice(error instanceof Error?error.message:'Unable to sync packages.');}
    finally {setBusy(false);}
  }
  return <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-5 text-zinc-100"><h2 className="text-lg font-semibold">Packages, gifts and subscriptions</h2><p className="text-sm text-zinc-400">Load Acuity products, orders, certificate codes and available remaining balances for Studio Chat. Refresh after package purchases or usage.</p><button onClick={sync} disabled={busy} className="rounded border border-zinc-600 px-4 py-2 disabled:opacity-50">{busy?'Syncing packages…':'Sync package data'}</button>{notice?<p role="status" className="text-sm">{notice}</p>:null}</section>;
}
