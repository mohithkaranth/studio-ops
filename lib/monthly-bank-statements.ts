import 'server-only';
import {sql} from '@/lib/db';
import {BANK_STATEMENT_SOURCE} from '@/lib/bank-report-source';

export type BankAccount={account_number:string;currency:string;latest_end:string};
export type BankStatementTransaction={id:string;upload_id:string;transaction_date:string;value_date:string|null;description_1:string|null;description_2:string|null;credit:string|null;debit:string|null;running_balance:string|null};
export type MonthlyBankStatement={month:string;account:BankAccount|null;accounts:BankAccount[];rows:BankStatementTransaction[];creditCents:number;debitCents:number;netCents:number;openingCents:number|null;closingCents:number|null;balanceDifferenceCents:number|null;coverageEnd:string|null;complete:boolean;coverageFromStart:boolean;warnings:string[]};

export function currentSingaporeMonth() {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit'}).formatToParts(new Date());
  return `${parts.find(p=>p.type==='year')!.value}-${parts.find(p=>p.type==='month')!.value}`;
}
export function monthDates(month:string) {
  if(!/^(?:19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Choose a valid month and year.');
  const start=`${month}-01`;
  const end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
  return {start,end,last:new Date(Date.parse(end)-86400000).toISOString().slice(0,10)};
}
export function bankCents(value:string|null) {
  if(value===null)return null;
  const number=Number(value);
  if(!Number.isFinite(number)||!Number.isSafeInteger(Math.round(number*100)))return null;
  return Math.round(number*100);
}
export function statementCoverage(start:string,last:string,periods:{from:string;to:string}[]) {
  const intervals=periods.filter(p=>p.from<=last&&p.to>=start).map(p=>({from:p.from<start?start:p.from,to:p.to>last?last:p.to})).sort((a,b)=>a.from.localeCompare(b.from));
  const merged:{from:string;to:string}[]=[];
  for(const interval of intervals) {
    const previous=merged.at(-1);
    if(previous && Date.parse(interval.from)<=Date.parse(previous.to)+86400000)previous.to=previous.to>interval.to?previous.to:interval.to;
    else merged.push({...interval});
  }
  return {complete:merged.length===1&&merged[0].from===start&&merged[0].to===last,fromStart:merged[0]?.from===start,end:merged.at(-1)?.to??null,gaps:merged.length>1};
}

export async function getMonthlyBankStatement(month:string,accountKey?:string):Promise<MonthlyBankStatement> {
  const {start,end,last}=monthDates(month);
  const accounts=await sql<BankAccount[]>`select account_number,upper(currency) as currency,max(statement_end_date)::text as latest_end from bank_statement_uploads where account_number is not null and currency is not null group by account_number,upper(currency) order by max(statement_end_date) desc,account_number,upper(currency)`;
  const account=accountKey?accounts.find(a=>`${a.account_number}|${a.currency}`===accountKey):accounts.find(a=>a.currency==='SGD')??accounts[0];
  if(accountKey&&!account)throw new Error('Choose an available bank account.');
  const empty:MonthlyBankStatement={month,accounts,account:account??null,rows:[],creditCents:0,debitCents:0,netCents:0,openingCents:null,closingCents:null,balanceDifferenceCents:null,coverageEnd:null,complete:false,coverageFromStart:false,warnings:[]};
  if(!account)return empty;
  const rows=await sql.unsafe<BankStatementTransaction[]>(`select id::text,upload_id::text,transaction_date::text,value_date::text,description_1,description_2,credit::text,debit::text,running_balance::text from ${BANK_STATEMENT_SOURCE} where account_number=$1 and currency=$2 and transaction_date >= $3::date and transaction_date < $4::date order by transaction_date,id`,[account.account_number,account.currency,start,end]);
  const periods=await sql<{from:string;to:string}[]>`select statement_start_date::text as "from",statement_end_date::text as "to" from bank_statement_uploads where account_number=${account.account_number} and upper(currency)=${account.currency} and statement_start_date<${end}::date and statement_end_date>=${start}::date`;
  const coverage=statementCoverage(start,last,periods);
  const creditCents=rows.reduce((total,row)=>total+(bankCents(row.credit)??0),0);
  const debitCents=rows.reduce((total,row)=>total+(bankCents(row.debit)??0),0);
  const netCents=creditCents-debitCents;
  const first=rows[0],final=rows.at(-1);
  let openingCents=coverage.fromStart&&first&&bankCents(first.running_balance)!==null?bankCents(first.running_balance)!-(bankCents(first.credit)??0)+(bankCents(first.debit)??0):null;
  let closingCents=final?bankCents(final.running_balance):null;
  // A statement with no movements still has balances when its header covers the month.
  if(!rows.length&&coverage.complete) {
    const anchors=await sql<{opening:string|null;closing:string|null}[]>`select opening_balance::text as opening,ledger_balance::text as closing from bank_statement_uploads where account_number=${account.account_number} and upper(currency)=${account.currency} and statement_start_date=${start}::date and statement_end_date=${last}::date order by id desc limit 1`;
    openingCents=bankCents(anchors[0]?.opening??null);closingCents=bankCents(anchors[0]?.closing??null);
  }
  const balanceDifferenceCents=openingCents===null||closingCents===null?null:closingCents-openingCents-netCents;
  const warnings:string[]=[];
  if(!coverage.complete)warnings.push(coverage.end?`Partial statement coverage through ${coverage.end}. This is not a complete calendar month.`:'No statement coverage is available for this month.');
  if(coverage.gaps)warnings.push('There are gaps between the uploaded statement periods.');
  if(rows.length&&openingCents===null)warnings.push('A month-opening balance cannot be verified from the available records.');
  if(rows.length&&closingCents===null)warnings.push('The last transaction has no saved balance.');
  if(balanceDifferenceCents!==null&&balanceDifferenceCents!==0)warnings.push('The recorded balances do not agree with the transaction totals. Check the uploaded statement records.');
  return {...empty,rows,creditCents,debitCents,netCents,openingCents,closingCents,balanceDifferenceCents,complete:coverage.complete,coverageFromStart:coverage.fromStart,coverageEnd:coverage.end,warnings};
}
