'use client';
import {useMemo,useState} from 'react';
import type {MonthlyBankStatement} from '@/lib/monthly-bank-statements';
import type {PdfChatMessage} from '@/lib/studio-chat-pdf';

export default function MonthlyTransactions({data}:{data:MonthlyBankStatement}) {
  const [search,setSearch]=useState('');
  const [exporting,setExporting]=useState(false);
  const [notice,setNotice]=useState('');
  const currency=data.account?.currency??'SGD';
  const money=(cents:number|null)=>cents===null?'Unavailable':new Intl.NumberFormat('en-SG',{style:'currency',currency,currencyDisplay:'code'}).format(cents/100);
  const amount=(value:string|null)=>value===null?'—':money(Math.round(Number(value)*100));
  const rows=useMemo(()=>data.rows.filter(row=>[row.transaction_date,row.value_date,row.description_1,row.description_2,row.credit,row.debit,row.running_balance].join(' ').toLowerCase().includes(search.trim().toLowerCase())),[data.rows,search]);
  const summary=`Monthly Bank Statement\nMonth: ${data.month}\nAccount: ${data.account?.account_number??'Unavailable'} · ${currency}\nCoverage: ${data.complete?'Complete calendar month':data.coverageEnd?`Partial, statements through ${data.coverageEnd}`:'No statement coverage'}\nOpening balance: ${money(data.openingCents)}\nTotal credits: ${money(data.creditCents)}\nTotal debits: ${money(data.debitCents)}\nNet movement: ${money(data.netCents)}\n${data.complete?'Closing balance':'Last recorded balance'}: ${money(data.closingCents)}\nTransactions: ${data.rows.length}\n${data.warnings.join('\n')}\nAll bank movements included. Duplicate source transactions counted once.`;
  async function download(kind:'excel'|'pdf') {
    setExporting(true);setNotice('');
    try {
      if(kind==='excel') {
        const XLSX=await import('xlsx');
        const workbook=XLSX.utils.book_new();
        const sheet=XLSX.utils.aoa_to_sheet([['Monthly Bank Statement',data.month],['Account',data.account?.account_number??'Unavailable'],['Currency',currency],['Coverage',data.complete?'Complete':data.coverageEnd?`Partial through ${data.coverageEnd}`:'No coverage'],['Opening balance',data.openingCents===null?'Unavailable':data.openingCents/100],['Total credits',data.creditCents/100],['Total debits',data.debitCents/100],['Net movement',data.netCents/100],[data.complete?'Closing balance':'Last recorded balance',data.closingCents===null?'Unavailable':data.closingCents/100],['Transactions',data.rows.length],['Warnings',data.warnings.join(' ')]]);
        for(let row=5;row<=9;row++)if(sheet['B'+row]?.t==='n')sheet['B'+row].z=`"${currency}" #,##0.00;[Red]-"${currency}" #,##0.00`;
        sheet['!cols']=[{wch:28},{wch:65}];XLSX.utils.book_append_sheet(workbook,sheet,'Summary');
        const transactions=XLSX.utils.json_to_sheet(data.rows.map(row=>({Date:row.transaction_date,'Value date':row.value_date??'',Description:[row.description_1,row.description_2].filter(Boolean).join(' '),Credit:row.credit===null?'':Number(row.credit),Debit:row.debit===null?'':Number(row.debit),'Running balance':row.running_balance===null?'':Number(row.running_balance)})));
        transactions['!cols']=[{wch:12},{wch:12},{wch:85},{wch:16},{wch:16},{wch:20}];
        for(let row=2;row<=data.rows.length+1;row++)for(const column of ['D','E','F'])if(transactions[column+row]?.t==='n')transactions[column+row].z=`"${currency}" #,##0.00;[Red]-"${currency}" #,##0.00`;
        XLSX.utils.book_append_sheet(workbook,transactions,'Transactions');XLSX.writeFile(workbook,`tonehouse-bank-${data.month}.xlsx`,{compression:true});
      } else {
        const {createStudioChatPdf}=await import('@/lib/studio-chat-pdf');
        const response=await fetch('/fonts/NotoSans-Regular.ttf');if(!response.ok)throw new Error('The PDF font could not load. Please retry.');
        const messages:PdfChatMessage[]=[{role:'assistant',content:summary}];
        for(let start=0;start<data.rows.length;start+=100)messages.push({role:'assistant',content:`Transactions ${start+1}–${Math.min(start+100,data.rows.length)} of ${data.rows.length}`,table:{columns:[{key:'date',label:'Date',format:'text'},{key:'valueDate',label:'Value date',format:'text'},{key:'description',label:'Description',format:'text'},{key:'credit',label:`Credit (${currency})`,format:'text'},{key:'debit',label:`Debit (${currency})`,format:'text'},{key:'balance',label:`Balance (${currency})`,format:'text'}],rows:data.rows.slice(start,start+100).map(row=>({date:row.transaction_date,valueDate:row.value_date,description:[row.description_1,row.description_2].filter(Boolean).join(' '),credit:amount(row.credit),debit:amount(row.debit),balance:amount(row.running_balance)}))}});
        const bytes=await createStudioChatPdf({mode:'report',messages,origin:window.location.origin,question:`Monthly Bank Statement · ${data.month}`},new Uint8Array(await response.arrayBuffer()));
        const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}));const link=document.createElement('a');link.href=url;link.download=`tonehouse-bank-${data.month}.pdf`;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
      }
      setNotice('Download complete. The export contains every transaction for this month.');
    } catch(error){setNotice(error instanceof Error?error.message:'Export failed. Please retry.');}finally{setExporting(false);}
  }
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="w-full space-y-2 text-sm sm:w-80"><span className="block text-zinc-300">Search transactions</span><input value={search} onChange={event=>setSearch(event.target.value)} type="search" placeholder="Description, date or amount" className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-zinc-100"/></label><div className="flex gap-2"><button disabled={exporting||!data.account} onClick={()=>download('excel')} className="rounded-md border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50">Download Excel</button><button disabled={exporting||!data.account} onClick={()=>download('pdf')} className="rounded-md border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50">{exporting?'Preparing…':'Download PDF'}</button></div></div>
    <p className="text-sm text-zinc-400">Showing {rows.length.toLocaleString('en-SG')} of {data.rows.length.toLocaleString('en-SG')} transactions. The summary and exports always cover the entire month.</p>
    {notice?<p role="status" className="text-sm text-zinc-300">{notice}</p>:null}
    <div className="overflow-x-auto rounded-xl border border-zinc-800"><table aria-label="Monthly bank transactions" className="w-full min-w-[800px] text-left text-sm"><thead className="bg-zinc-900 text-zinc-400"><tr>{['Date','Value date','Description','Credit','Debit','Running balance'].map((label,index)=><th key={label} className={`px-4 py-3 font-medium ${index>=3?'text-right':''}`}>{label}</th>)}</tr></thead><tbody className="divide-y divide-zinc-800 bg-zinc-950">{rows.length?rows.map(row=><tr key={row.id} id={`transaction-${row.id}`} className="even:bg-zinc-900/40"><td className="whitespace-nowrap px-4 py-3">{row.transaction_date}</td><td className="whitespace-nowrap px-4 py-3 text-zinc-400">{row.value_date??'—'}</td><td className="min-w-72 px-4 py-3 text-zinc-300">{[row.description_1,row.description_2].filter(Boolean).join(' ')||'—'}</td><td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{amount(row.credit)}</td><td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{amount(row.debit)}</td><td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{amount(row.running_balance)}</td></tr>):<tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-400">{search?'No transactions match this search.':'No saved bank transactions dated in this month.'}</td></tr>}</tbody></table></div>
  </section>;
}
