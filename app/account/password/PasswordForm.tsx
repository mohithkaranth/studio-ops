'use client';
import {useState,type FormEvent} from 'react';
export default function PasswordForm() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();if(busy)return;
    const form=event.currentTarget,values=new FormData(form);setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch('/api/auth/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:values.get('currentPassword'),newPassword:values.get('newPassword'),confirmPassword:values.get('confirmPassword')})});
      const result=await response.json();if(!response.ok)throw new Error(result.error??'Password change could not finish.');
      form.reset();setNotice('Password updated. Other sessions have been signed out.');
    }catch(issue){setError(issue instanceof Error?issue.message:'Please retry.');}finally{setBusy(false);}
  }
  return <form onSubmit={submit} className="mt-8 space-y-5 rounded-xl border border-zinc-800 bg-zinc-900 p-6">{[{name:'currentPassword',label:'Current password',autoComplete:'current-password'},{name:'newPassword',label:'New password',autoComplete:'new-password'},{name:'confirmPassword',label:'Confirm new password',autoComplete:'new-password'}].map(field=><div key={field.name}><label htmlFor={field.name} className="mb-2 block text-sm">{field.label}</label><input id={field.name} name={field.name} type="password" required autoComplete={field.autoComplete} minLength={field.name==='currentPassword'?undefined:15} maxLength={field.name==='currentPassword'?512:128} className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-3 outline-none focus:border-zinc-400"/></div>)}{error?<p role="alert" className="text-sm text-red-300">{error}</p>:null}{notice?<p role="status" className="text-sm text-green-300">{notice}</p>:null}<button disabled={busy} className="rounded-lg bg-zinc-100 px-4 py-3 text-zinc-950 disabled:opacity-50">{busy?'Updating…':'Update password'}</button></form>;
}
