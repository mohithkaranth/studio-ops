import Link from 'next/link';
import {requireStudioSession} from '@/lib/studio-auth-request';
import {getMonthlyBankStatement,currentSingaporeMonth,monthDates,type MonthlyBankStatement} from '@/lib/monthly-bank-statements';
import MonthlyTransactions from './MonthlyTransactions';

export const dynamic='force-dynamic';
type Params=Promise<Record<string,string|string[]|undefined>>;
const first=(value:string|string[]|undefined)=>Array.isArray(value)?value[0]:value;
const money=(value:number|null,currency:string)=>value===null?'Unavailable':new Intl.NumberFormat('en-SG',{style:'currency',currency,currencyDisplay:'code'}).format(value/100);

export default async function MonthlyBankStatementsPage({searchParams}:{searchParams:Params}) {
  await requireStudioSession();
  const params=await searchParams;
  let month=first(params.month)??currentSingaporeMonth();
  let accountKey=first(params.account);
  let validation:string|null=null;
  try {monthDates(month);}catch {validation='Choose a valid month and year.';month=currentSingaporeMonth();}
  let data:MonthlyBankStatement;
  try {data=await getMonthlyBankStatement(month,accountKey);}catch(error) {
    if(!(error instanceof Error)||error.message!=='Choose an available bank account.')throw error;
    validation=error.message;accountKey=undefined;data=await getMonthlyBankStatement(month);
  }
  const currency=data.account?.currency??'SGD';
  const selectedAccount=data.account?`${data.account.account_number}|${currency}`:'';
  const label=new Intl.DateTimeFormat('en-SG',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${month}-01T00:00:00Z`));
  const cards=[['Opening balance',money(data.openingCents,currency)],['Total credits',money(data.creditCents,currency)],['Total debits',money(data.debitCents,currency)],['Net movement',money(data.netCents,currency)],[data.complete?'Closing balance':'Last recorded balance',money(data.closingCents,currency)],['Transactions',data.rows.length.toLocaleString('en-SG')]];
  return <main className="min-h-screen w-full bg-zinc-950 text-zinc-100"><div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8 sm:py-10">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-3xl font-semibold text-zinc-50">Bank Statements</h1><p className="mt-2 text-sm text-zinc-400">All bank transactions by calendar month, with money in, money out and balances.</p></div><Link href="/bank-statements" className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-100 hover:bg-zinc-900">Upload statements</Link></header>
    <form className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <label className="space-y-2 text-sm"><span className="block text-zinc-300">Month and year</span><input name="month" type="month" defaultValue={month} required className="rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100 [color-scheme:dark]"/></label>
      <label className="min-w-0 flex-1 space-y-2 text-sm sm:flex-none"><span className="block text-zinc-300">Bank account</span><select name="account" defaultValue={selectedAccount} className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100">{data.accounts.length?data.accounts.map(account=><option key={`${account.account_number}|${account.currency}`} value={`${account.account_number}|${account.currency}`}>{account.account_number} · {account.currency}</option>):<option value="">No uploaded accounts</option>}</select></label>
      <button className="rounded-md bg-zinc-100 px-5 py-2 text-sm font-semibold text-zinc-950 hover:bg-white">View month</button>
    </form>
    {validation?<p role="alert" className="text-sm text-amber-300">{validation}</p>:null}
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">{label}</h2><p className="text-sm text-zinc-400">{data.complete?'Complete statement coverage':data.coverageEnd?`Partial month · statements through ${data.coverageEnd}`:'No statement coverage'}</p></div>
    <section aria-label="Monthly bank summary" className="grid grid-cols-2 gap-3 lg:grid-cols-3">{cards.map(([title,value])=><div key={title} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4"><p className="text-xs uppercase tracking-wide text-zinc-400">{title}</p><p className="mt-2 break-words text-base font-semibold text-zinc-50 sm:text-xl">{value}</p></div>)}</section>
    <p className="text-sm leading-6 text-zinc-400">Totals include every bank transaction dated in this month, including transfers and other non-session payments. Overlapping uploads are counted once. {data.complete?'Balances cover the selected month.':data.coverageEnd?`The available records cover only part of the month. The last recorded balance is the balance after the latest saved transaction.`:'Upload statements covering this month to establish its balances.'}</p>
    {data.warnings.length?<div role="status" className="space-y-1 rounded-xl border border-amber-900/70 bg-amber-950/20 p-4 text-sm text-amber-200">{data.warnings.map(warning=><p key={warning}>{warning}</p>)}{data.balanceDifferenceCents!==null&&data.balanceDifferenceCents!==0?<p>Balance difference: {money(data.balanceDifferenceCents,currency)}</p>:null}</div>:data.balanceDifferenceCents===0?<p className="text-sm text-emerald-300">Opening balance + credits − debits agrees with the recorded closing balance.</p>:null}
    <MonthlyTransactions data={data}/>
  </div></main>;
}
