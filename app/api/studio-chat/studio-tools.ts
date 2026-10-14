import {CUSTOMER_IDENTITY_SQL} from '@/lib/customer-identity';
import {findAcuityPackages} from '@/lib/acuity/packages';
import {getCustomerAnalytics} from '@/lib/customer-analytics';
import {findCustomerContacts} from '@/lib/customer-contacts';
import { sql } from '@/lib/db';
import { bankTransactionKey, ensureBankAllocationTables } from '@/lib/bank-allocations';
import { ignoredBankCredit } from '@/lib/bank-credit-exclusions';
import { getSavedUnsettledYear } from '@/lib/reconciliation-cache';
import { displayReconciliationStatus } from '@/lib/reconciliation-status';
import { extractSemanticQuery } from './intent-extractor';
import { validateAndNormalizeSemanticQuery } from './semantic-validator';
import { parseDateMention } from './date-parser';
import { executeSemanticQuery } from './result-shaper';
import { renderAnswer } from './answer-renderer';
import { getCustomerProfile } from '@/lib/customer-profiles';
import { studioReportTable } from './report-table';
import type {ReportTable} from '@/lib/studio-chat-table';
import {isComparisonQuery} from './semantic-query';

export type EvidenceLink = { label: string; href: string };
export type ToolResult = { data: unknown; sources: EvidenceLink[] };
type Args = Record<string, unknown>;
const nullableString = { type: ['string', 'null'] };
function tool(name: string, description: string, properties: Record<string, unknown>) {
  return { type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } };
}
export const studioTools = [
  tool('find_acuity_packages', 'Look up saved Acuity package/gift/subscription products, orders and certificate codes by customer name, email, phone, product name, order ID or code. Use immediately for package purchases, package balances/expiry and package usage; null search returns all. Includes purchaser details, order totals/status, remaining minutes/counts/value, and stored bookings redeeming the code. Buyer and session customer may differ. Payment method/processor references are unavailable; paid status is not proof of card or PayNow. Balances are snapshots as of synced_at. Do not ask confirmation to read package data.', {search:nullableString}),
  tool('find_customer_contacts', 'Find all matching contact details from saved Acuity customer records AND booking contacts in one read-only lookup. Use immediately for phone/contact questions; never ask the user to pick one profile before showing matching contacts. Handles 8-digit Singapore phones and +65 formats, and exact emails within comma-separated email fields. source=customers reads acuity_clients directly (including saved normalized phone values), bookings reads booking contacts, both checks both. Returns distinct phone values over ALL matches and up to 100 distinct contact rows with their source; do not substitute a secondary email belonging to another person. For all/all of them, show every matching contact separately without another confirmation.', {search:{type:'string'},source:{type:'string',enum:['customers','bookings','both']}}),
  tool('get_customer_analytics', 'Run the SAME lost-customer calculation as the Customer Analytics page. Analysis months determine regularity; inactivity is checked over the last selected number of months from today using session dates. Defaults: analysis ending 3 complete months before current month, 12-month analysis, average 2/month, minimum 10 lifetime bookings, inactive 3 months. Use for lost/inactive/lapsed customers and preserve explicitly requested thresholds. Exact totals; table displays up to 100 customers.', {fromMonth:nullableString,toMonth:nullableString,averageBookings:{type:['number','null']},inactiveMonths:{type:['integer','null'],enum:[3,6,9,12,null]},minimumLifetimeBookings:{type:['integer','null']}}),
  tool('get_client_booking_report', 'Return a finished top-client table with exact booking counts, booking-type counts and total Acuity cost in ONE lookup. Use for top clients/customers, client booking reports, and follow-ups adding revenue/types/table to that report. Rank by booking_count unless the user specifically requests highest Acuity value. Preserve the prior range, ranking and limit on follow-ups. Cost is Acuity booking value, not confirmed bank receipts or invoice extras. Dates are Singapore session dates unless dateBasis is created_datetime. Do not fetch each client separately.', {startDate:nullableString,endDateExclusive:nullableString,limit:{type:'integer',minimum:1,maximum:100},rankBy:{type:'string',enum:['booking_count','acuity_cost']},dateBasis:{type:'string',enum:['appointment_datetime','created_datetime']}}),
  tool('get_bank_cash_movement', 'Prepare an exact bank cash-movement summary: credits, debits, net movement and counts calculated by the app. Use this for money-in versus money-out or cash-movement reports instead of doing arithmetic yourself. Returns ready-to-use report text and evidence from both directions. It is not a balance sheet or profit statement.', {startDate:nullableString,endDateExclusive:nullableString}),
  tool('get_customer_profile', 'Find a stored customer profile by name, email or phone. Returns available contact details, full-history counts and Acuity value, plus saved notes/form answers from up to 30 latest bookings. If several people match, ask for clarification and do not merge their details. Missing notes/forms mean not stored. This uses stored database records and does not fetch invoices.', {search:{type:'string'}}),
  tool('find_bank_payments', 'Search actual incoming SGD bank credits. Returns exact count and total over ALL matches, up to 100 evidence rows and their ignored/matched/allocated status. Multiple payer terms are OR; use separate calls for per-payer totals. Raw bank searches include ignored credits; use get_reconciliation_results for unsettled totals.', {
    searchTerms: { type: 'array', items: { type: 'string' }, maxItems: 8 }, startDate: nullableString, endDateExclusive: nullableString,
  }),
  tool('find_bank_debits', 'Search actual outgoing SGD bank debits: expenses, spending, withdrawals and payments to vendors or people. Returns exact count and total over ALL matches and up to 100 evidence rows with bank links. Use an empty searchTerms array for all debits. Multiple vendor terms are OR; use separate calls for per-vendor totals. Debit amounts are positive amounts spent. Credit reconciliation exclusions do not apply to outgoing debits.', {
    searchTerms: { type: 'array', items: { type: 'string' }, maxItems: 8 }, startDate: nullableString, endDateExclusive: nullableString,
  }),
  tool('find_acuity_bookings', 'Find a client’s non-cancelled Acuity bookings and sum their actual Acuity prices. Date range is Singapore session dates. Returns count, total and up to 100 bookings with links, creation dates and package codes. Acuity paid flags alone are not proof of bank settlement.', {
    client: nullableString, startDate: nullableString, endDateExclusive: nullableString, allMatches:{type:'boolean',description:'True when the user says all/all of them or asks to inspect all matching records. Different customer emails remain visible on individual booking rows.'},
  }),
  tool('get_booking_details', 'Check one booking’s current Acuity price, priceSold, amountPaid, paid flag, certificate and add-ons directly from Acuity. Use to verify saved prices. Invoice extras are not included unless returned by Acuity.', { appointmentId: { type: 'string' } }),
  tool('get_reconciliation_results', 'Read saved yearly reconciliation including unsettled bookings, their PayNow candidates and yearly unaccounted totals. Never starts payment checks. Reports missing/stale months. Client filter narrows bookings but yearly PayNow total always remains a whole-year pooled comparison, not assigned to that client.', {
    year: { type: 'integer', minimum: 2026 }, client: nullableString, month: {type:['integer','null'],minimum:1,maximum:12},
  }),
  tool('query_studio_report', 'Run an existing validated Studio Ops report for revenue, debits, utilisation-related booking counts, grouped months/rooms/types and bank-versus-Acuity comparisons. Supply a fully self-contained question with the dates and context resolved from the conversation.', { question: { type: 'string' } }),
];

function date(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0,10) !== value) throw new Error('Use valid YYYY-MM-DD dates.');
  return value;
}
function range(args: Args) {
  const start = date(args.startDate), end = date(args.endDateExclusive);
  if (start && end && start >= end) throw new Error('The end date must be after the start date.');
  return { start, end };
}
function pattern(value: string) {
  const terms = value.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!terms.length || value.length > 200) throw new Error('Use a short payer or client name.');
  return '%' + terms.join('%') + '%';
}

export async function runStudioTool(name: string, args: Args): Promise<ToolResult> {
  if(name==='find_acuity_packages') {
    if(args.search!==null && typeof args.search!=='string') throw new Error('Use a customer, product or code search.');
    return {data:await findAcuityPackages(args.search as string|null),sources:[{label:'Saved Acuity package data · refresh',href:'/acuity-sync'}]};
  }
  if(name==='find_customer_contacts') {
    if(typeof args.search!=='string'||!['customers','bookings','both'].includes(String(args.source))) throw new Error('Choose a customer search and contact source.');
    const result=await findCustomerContacts(args.search,args.source as 'customers'|'bookings'|'both');
    const table:ReportTable={columns:[{key:'name',label:'Name',format:'text'},{key:'email',label:'Email(s) on record',format:'text'},{key:'phone',label:'Saved phone',format:'text'},{key:'normalized',label:'Phone with country code',format:'text'},{key:'storedNormalized',label:'Customer normalized phone',format:'text'},{key:'source',label:'Source',format:'text'}],rows:result.contacts.map(row=>({name:row.name,email:row.email,phone:row.phone,normalized:row.normalized_phone?'+'+row.normalized_phone:null,storedNormalized:row.saved_normalized_phone,source:row.source}))};
    return {data:{...result,report:{answer:`Customer contact lookup: ${args.search}\nChecked ${result.customer_records} matching customer records and ${result.booking_records} matching booking contacts. Showing ${result.contacts.length} of ${result.contact_count} distinct contact records.\n\n${result.phones.length?`Distinct phones found: ${result.phones.map(phone=>'+'+phone).join(', ')}.`:'No phone number was found in these saved matching records.'}\n${result.saved_customer_phones.length?`Phones present in customer records: ${result.saved_customer_phones.map(phone=>'+'+phone).join(', ')}.`:''}\n\nDifferent contact records are shown separately; shared names or secondary emails do not establish that they are the same person.`,table}},sources:result.contacts.filter(row=>row.source==='Booking contact').slice(0,20).map(row=>({label:`${row.name} · contact on booking ${row.id}`,href:`/acuity/appointments/${row.id}`}))};
  }
  if (name === 'get_customer_analytics') {
    const parts = new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Singapore',year:'numeric',month:'2-digit'}).formatToParts(new Date());
    const current = new Date(Date.UTC(Number(parts.find(p=>p.type==='year')!.value),Number(parts.find(p=>p.type==='month')!.value)-1,1));
    const month = (offset:number) => new Date(Date.UTC(current.getUTCFullYear(),current.getUTCMonth()+offset,1)).toISOString().slice(0,7);
    const fromMonth = args.fromMonth === null ? month(-15) : String(args.fromMonth);
    const toMonth = args.toMonth === null ? month(-4) : String(args.toMonth);
    const averageBookings = args.averageBookings === null ? 2 : Number(args.averageBookings);
    const inactiveMonths = args.inactiveMonths === null ? 3 : Number(args.inactiveMonths);
    const minimumLifetimeBookings = args.minimumLifetimeBookings === null ? 10 : Number(args.minimumLifetimeBookings);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(fromMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(toMonth) || fromMonth>toMonth || toMonth>month(-4)) throw new Error('Choose valid analysis months ending at least 3 complete months before the current month.');
    if (!Number.isFinite(averageBookings)||averageBookings<1||![3,6,9,12].includes(inactiveMonths)||!Number.isInteger(minimumLifetimeBookings)||minimumLifetimeBookings<1) throw new Error('Use a minimum average of at least 1, inactivity of 3/6/9/12 months and a positive whole-number minimum lifetime count.');
    const results = await getCustomerAnalytics({fromMonth,toMonth,averageBookings,inactiveMonths,minimumLifetimeBookings});
    const summary = results[0];
    const customers = results.filter(row=>row.customer_key).slice(0,100);
    const table:ReportTable={columns:[{key:'client',label:'Client name',format:'text'},{key:'email',label:'Email',format:'text'},{key:'phone',label:'Phone',format:'text'},{key:'last',label:'Last session',format:'text'},{key:'bookings',label:'Lifetime bookings',format:'number'},{key:'average',label:'Average bookings / month',format:'number'},{key:'inactive',label:'Months inactive',format:'number'}],rows:customers.map(row=>({client:row.client,email:row.email,phone:row.phone,last:row.last_booking,bookings:row.total_bookings,average:Number(row.average_bookings_per_month),inactive:row.months_inactive}))};
    const href=`/customer-analytics?analysed=1&${new URLSearchParams({fromMonth,toMonth,averageBookings:String(averageBookings),inactiveMonths:String(inactiveMonths),minimumLifetimeBookings:String(minimumLifetimeBookings)})}`;
    return {data:{report:{answer:`Lost customers: ${summary?.lost_customers??0}. Showing ${customers.length} of ${summary?.lost_customers??0}.\nRegular customers: ${summary?.regular_customers??0}; customers analysed: ${summary?.customers_analysed??0}.\nAnalysis: ${fromMonth} to ${toMonth}; minimum average ${averageBookings}/month; minimum lifetime bookings ${minimumLifetimeBookings}; no sessions in the last ${inactiveMonths} months.\n\nSame calculation as Customer Analytics, using saved non-cancelled session records. The monthly average divides bookings by every month in the selected analysis period. Results identify inactivity, not why someone stopped visiting.`,table}},sources:[{label:'View the same Customer Analytics results',href}]};
  }
  if(name==='get_client_booking_report') {
    const {start,end}=range(args);
    const limit=Number(args.limit);
    if(!Number.isInteger(limit)||limit<1||limit>100) throw new Error('Choose between 1 and 100 clients.');
    if(!['booking_count','acuity_cost'].includes(String(args.rankBy))||!['appointment_datetime','created_datetime'].includes(String(args.dateBasis))) throw new Error('Choose a valid ranking and booking date basis.');
    const dateColumn=args.dateBasis==='created_datetime'?sql`a.created_datetime`:sql`a.appointment_datetime`;
    const ordering=args.rankBy==='acuity_cost'?sql`cost_cents::numeric desc,booking_count desc,identity`:sql`booking_count desc,cost_cents::numeric desc,identity`;
    type ClientRow={identity:string;client:string;booking_count:number;cost_cents:string;missing_prices:number;example_id:string;types:{type:string;count:number}[]};
    const clients=await sql<ClientRow[]>`
      with bookings as (
        select a.acuity_appointment_id::text as id,
          ${sql.unsafe(CUSTOMER_IDENTITY_SQL)} as identity,
          coalesce(nullif(trim(concat_ws(' ',a.client_first_name,a.client_last_name)),''),nullif(trim(a.client_email),''),'Unknown customer') as client,
          coalesce(nullif(a.appointment_type_name,''),'Unknown booking type') as type,round(a.price*100) as cents,a.appointment_datetime
        from acuity_appointments a where coalesce(a.canceled,false)=false
          and (${start}::date is null or ${dateColumn}>=(${start}::date::timestamp at time zone 'Asia/Singapore'))
          and (${end}::date is null or ${dateColumn}<(${end}::date::timestamp at time zone 'Asia/Singapore'))
      ), totals as (
        select identity,(array_agg(client order by appointment_datetime desc,id))[1] as client,count(*)::int as booking_count,
          coalesce(sum(cents),0)::text as cost_cents,count(*) filter(where cents is null)::int as missing_prices,
          (array_agg(id order by appointment_datetime desc,id))[1] as example_id from bookings group by identity
      ), selected as (select * from totals order by ${ordering} limit ${limit}),
      types as (select b.identity,b.type,count(*)::int as count from bookings b join selected s on s.identity=b.identity group by b.identity,b.type)
      select s.*,coalesce((select jsonb_agg(t order by t.count desc,t.type) from types t where t.identity=s.identity),'[]'::jsonb) as types
        from selected s order by ${ordering}`;
    const table:ReportTable={columns:[{key:'client',label:'Client name',format:'text'},{key:'bookings',label:'Number of bookings',format:'number'},{key:'types',label:'Booking types',format:'text'},{key:'cost',label:'Acuity cost',format:'money'}],
      rows:clients.map(row=>({client:clients.some(other=>other.identity!==row.identity&&other.client===row.client)&&row.identity.startsWith('email:')?`${row.client} (${row.identity.slice(6)})`:row.client,
        bookings:row.booking_count,types:row.types.map(type=>`${type.type} (${type.count})`).join('\n'),cost:row.missing_prices?null:Number(row.cost_cents)/100}))};
    const lastDay=end?new Date(Date.parse(end)-86400000).toISOString().slice(0,10):'latest stored date';
    const missing=clients.reduce((sum,row)=>sum+row.missing_prices,0);
    const total=clients.reduce((sum,row)=>sum+Number(row.cost_cents),0);
    const answer=`Top ${clients.length} clients by ${args.rankBy==='acuity_cost'?'Acuity cost':'number of bookings'}\nPeriod: ${start??'earliest stored date'} to ${lastDay}, by ${args.dateBasis==='created_datetime'?'booking created date':'Singapore session date'}.\n\n${clients.reduce((sum,row)=>sum+row.booking_count,0)} bookings in the clients shown. ${missing?`${missing} bookings have no saved price; affected client costs are unavailable.`:`Total Acuity cost for these clients: SGD ${(total/100).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})}.`}\n\nCancelled bookings excluded. Acuity cost is booking value, not confirmed bank receipts; invoice-only extras are unavailable.`;
    return {data:{report:{answer,table},startDate:start,endDateExclusive:end,limit,rankBy:args.rankBy,dateBasis:args.dateBasis},sources:clients.slice(0,20).map(row=>({label:`${row.client} · example booking`,href:`/acuity/appointments/${row.example_id}`}))};
  }
  if (name === 'get_bank_cash_movement') {
    const {start,end}=range(args);
    const credits=await runStudioTool('find_bank_payments',{searchTerms:[],startDate:start,endDateExclusive:end});
    const debits=await runStudioTool('find_bank_debits',{searchTerms:[],startDate:start,endDateExclusive:end});
    const incoming=credits.data as {count:number;totalCents:number};
    const outgoing=debits.data as {count:number;totalCents:number};
    const net=incoming.totalCents-outgoing.totalCents;
    const money=(cents:number)=>`SGD ${(cents/100).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})}`;
    const lastDay=end ? new Date(Date.parse(end)-86400000).toISOString().slice(0,10) : 'latest uploaded date';
    const period=`${start??'earliest uploaded date'} to ${lastDay}`;
    const reportText=`Bank Cash-Movement Report\nPeriod: ${period}\n\nTotal credits: ${money(incoming.totalCents)} across ${incoming.count} incoming transactions.\nTotal debits: ${money(outgoing.totalCents)} across ${outgoing.count} outgoing transactions.\nNet bank movement: ${money(net)} (${net>=0?'net inflow':'net outflow'}).\n\nCoverage: uploaded SGD bank transactions, with duplicate source records counted once. Credits include transfers and items ignored for reconciliation.\n\nThis is a cash-movement report, not a complete balance sheet or profit statement. It does not establish opening cash, other assets, liabilities or equity.`;
    return {data:{period,creditCents:incoming.totalCents,debitCents:outgoing.totalCents,netCents:net,creditCount:incoming.count,debitCount:outgoing.count,reportText},sources:[...credits.sources.slice(0,10),...debits.sources.slice(0,10)]};
  }
  if (name === 'get_customer_profile') {
    if (typeof args.search !== 'string') throw new Error('Specify the customer to look up.');
    const data = await getCustomerProfile(args.search);
    return {data,sources:(data.bookings ?? []).map(booking=>({label:`${data.customer?.name ?? 'Customer'} · ${booking.date.slice(0,10)}`,href:booking.href}))};
  }
  if (name === 'find_bank_payments' || name === 'find_bank_debits') {
    const incoming = name === 'find_bank_payments';
    const amount = incoming ? sql`t.credit` : sql`t.debit`;
    const sourceKey = incoming ? bankTransactionKey : sql`md5(${bankTransactionKey} || ':' || round(coalesce(t.debit,0)*100)::bigint::text)`;
    await ensureBankAllocationTables();
    const { start, end } = range(args);
    if (!Array.isArray(args.searchTerms) || args.searchTerms.length > 8 || args.searchTerms.some(term=>typeof term !== 'string')) throw new Error('Use up to eight search terms.');
    const searchFilter = args.searchTerms.length ? args.searchTerms.reduce((combined, term) => {
      pattern(String(term));
      const words = String(term).toLowerCase().match(/[a-z0-9]+/g)!;
      const phrase = words.reduce((condition, word) => sql`${condition} and concat_ws(' ',t.description_1,t.description_2) ilike ${'%'+word+'%'}`, sql`true`);
      return sql`${combined} or (${phrase})`;
    }, sql`false`) : sql`true`;
    const result = await sql<{ count: number; totalCents: string; records: { id: string; upload_id: number; date: string; description: string; cents: number; allocated_cents: number; matched: boolean }[] }[]>`
      with matched as (
        select distinct on (${sourceKey}) t.id::text, t.upload_id, t.transaction_date::date::text as date,
          concat_ws(' ',t.description_1,t.description_2) as description, round(${amount}*100)::float8 as cents,
          coalesce((select sum(a.allocated_cents) from bank_payment_allocations a where a.transaction_key=${bankTransactionKey} and a.released_at is null),0)::float8 as allocated_cents,
          exists(select 1 from bank_paynow_matches m where m.transaction_key=${bankTransactionKey}) as matched
        from bank_transactions t join bank_statement_uploads u on u.id=t.upload_id
        where ${incoming ? sql`t.credit > 0 and coalesce(t.debit,0)=0` : sql`t.debit > 0 and coalesce(t.credit,0)=0`} and upper(u.currency)='SGD'
          and (${start}::date is null or t.transaction_date >= ${start}::date)
          and (${end}::date is null or t.transaction_date < ${end}::date)
          and (${searchFilter})
        order by ${sourceKey},t.id
      ) select count(*)::int as count, coalesce(sum(cents),0)::text as "totalCents",
        coalesce((select jsonb_agg(r) from (select * from matched order by date,id limit 100) r),'[]'::jsonb) as records from matched`;
    const data = result[0];
    return { data: { ...data, transactionType: incoming ? 'credit' : 'debit', totalCents: Number(data.totalCents), records: data.records.map(row=>({ ...row, status: !incoming ? 'Outgoing bank debit' : ignoredBankCredit(row.description) ? 'Ignored for reconciliation' : row.matched ? 'PayNow matched (accounted for)' : row.allocated_cents ? 'Saved allocation' : 'Unaccounted', href: `/bank-statements?uploadId=${row.upload_id}#payment-${row.id}` })) }, sources: data.records.map(row=>({label:`${row.date} · ${incoming ? 'Credit' : 'Debit'} SGD ${(row.cents/100).toFixed(2)} · ${row.description}`,href:`/bank-statements?uploadId=${row.upload_id}#payment-${row.id}`})) };
  }
  if (name === 'find_acuity_bookings') {
    const { start, end } = range(args);
    const profile = typeof args.client === 'string' && args.client.trim() ? await getCustomerProfile(args.client) : null;
    if (profile && !profile.found && !(args.allMatches===true && profile.needsClarification)) return {data:profile,sources:[]};
    const identity = profile?.customer?.identity ?? null;
    const nameSearch = profile?.needsClarification && args.allMatches===true ? pattern(String(args.client)) : null;
    const result = await sql<{ count: number; totalCents: string; missingPrices: number; records: Record<string, unknown>[] }[]>`
      with bookings as (select acuity_appointment_id::text as id, concat_ws(' ',client_first_name,client_last_name) as client,
        client_email, appointment_datetime, created_datetime, appointment_type_name, calendar_name, price, paid_status, certificate_code
        from acuity_appointments where coalesce(canceled,false)=false
          and (${start}::date is null or appointment_datetime >= (${start}::date::timestamp at time zone 'Asia/Singapore'))
          and (${end}::date is null or appointment_datetime < (${end}::date::timestamp at time zone 'Asia/Singapore'))
          and (${identity}::text is null or ${sql.unsafe(CUSTOMER_IDENTITY_SQL)}=${identity})
          and (${nameSearch}::text is null or ${sql.unsafe(CUSTOMER_IDENTITY_SQL)} in (select ${sql.unsafe(CUSTOMER_IDENTITY_SQL)} from acuity_appointments where concat_ws(' ',client_first_name,client_last_name,client_email) ilike ${nameSearch})))

      select count(*)::int as count, coalesce(sum(round(price*100)),0)::text as "totalCents", count(*) filter(where price is null)::int as "missingPrices",
        coalesce((select jsonb_agg(r) from (select * from bookings order by appointment_datetime,id limit 100) r),'[]'::jsonb) as records from bookings`;
    const data = result[0];
    return { data: {...data,scope:nameSearch?'All matching customer records; individual booking emails identify each record':'Resolved customer',totalCents:Number(data.totalCents),records:data.records.map(row=>({...row,href:`/acuity/appointments/${row.id}`}))},sources:data.records.map(row=>({label:`${row.client} · ${String(row.appointment_datetime).slice(0,10)} · ${row.appointment_type_name}`,href:`/acuity/appointments/${row.id}`})) };
  }
  if (name === 'get_booking_details') {
    const id = String(args.appointmentId);
    if (!/^\d+$/.test(id)) throw new Error('Use a valid Acuity booking ID.');
    const user = process.env.ACUITY_USER_ID, key = process.env.ACUITY_API_KEY;
    if (!user || !key) throw new Error('Acuity connection is unavailable.');
    const response = await fetch(`https://acuityscheduling.com/api/v1/appointments/${id}`, {headers:{Authorization:'Basic '+Buffer.from(`${user}:${key}`).toString('base64')},cache:'no-store',signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error('Current Acuity booking details could not be checked.');
    const record = await response.json();
    const fields = ['id','firstName','lastName','email','datetime','dateCreated','type','calendar','price','priceSold','paid','amountPaid','certificate','addonIDs'];
    return {data:Object.fromEntries(fields.filter(field=>field in record).map(field=>[field,record[field]])),sources:[{label:`Acuity booking ${id}`,href:`/acuity/appointments/${id}`}]};
  }
  if (name === 'get_reconciliation_results') {
    const year = Number(args.year);
    const currentYear = Number(new Intl.DateTimeFormat('en',{year:'numeric',timeZone:'Asia/Singapore'}).format(new Date()));
    if (!Number.isInteger(year) || year < 2026 || year > currentYear) throw new Error('Choose an available reconciliation year.');
    const state = await getSavedUnsettledYear(year);
    const month = args.month === null || args.month === undefined ? null : Number(args.month);
    if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) throw new Error('Choose a valid month.');
    const words = typeof args.client==='string' ? args.client.toLowerCase().split(/\s+/).filter(Boolean) : [];
    const inScope = (row: import('@/lib/stripe/reconciliation').ReconciliationRow) => new Date(row.appointmentDate).getTime()<=Date.now()
      && words.every(word=>`${row.client} ${row.email ?? ''}`.toLowerCase().includes(word))
      && (month===null || Number(new Intl.DateTimeFormat('en',{timeZone:'Asia/Singapore',month:'numeric'}).format(new Date(row.appointmentDate)))===month);
    const snapshots = await sql<{ rows: import('@/lib/stripe/reconciliation').ReconciliationRow[] }[]>`select rows from reconciliation_month_snapshots where year=${year} and month=any(${sql.array(state.months)}::int[])`;
    const allBookings = snapshots.flatMap(item=>item.rows).filter(inScope).sort((a,b)=>b.appointmentDate.localeCompare(a.appointmentDate));
    const rows = state.rows.filter(inScope);
    const ids = [...new Set(allBookings.slice(0,100).flatMap(row=>row.bankMatch.candidates.map(candidate=>candidate.transactionId)))];
    const payments = ids.length ? await sql<{id:string;uploadId:number}[]>`select id::text,upload_id as "uploadId" from bank_transactions where id::text=any(${sql.array(ids)}::text[])` : [];
    const paymentHref = (id:string) => {const payment=payments.find(item=>item.id===id); return payment ? `/bank-statements?uploadId=${payment.uploadId}#payment-${id}` : null;};
    return { data: {year,month,checkedAt:state.checkedAt,stale:state.stale,missingMonths:state.missingMonths,unchecked:state.unchecked,
      yearlyTotals:state.totals ? {acuityCostCents:state.totals.acuityCostCents,payNowCents:state.totals.payNowCents,creditCount:state.totals.creditCount} : null,
      filteredUnsettledCount:rows.length,filteredAcuityCostCents:rows.some(row=>row.costCents===null) ? null : rows.reduce((sum,row)=>sum+(row.costCents??0),0),
      bookings:allBookings.slice(0,100).map(row=>({appointmentId:row.appointmentId,client:row.client,sessionDate:row.appointmentDate,bookedOn:row.createdDate,
        type:row.appointmentType,acuityCostCents:row.costCents,stripePaidCents:row.stripeCents,status:displayReconciliationStatus(row),
        confirmedPayNowCents:row.bankMatch.confirmedCents,
        payNowPayments:row.bankMatch.candidates.map(candidate=>({date:candidate.date,cents:candidate.cents,allocatedCents:candidate.allocatedCents??null,
          payer:candidate.payer,description:[candidate.description,candidate.description2].filter(Boolean).join(' '),matchBasis:candidate.reason,
          accountedFor:displayReconciliationStatus(row)==='PayNow matched'||row.bankMatch.bankStatus==='Confirmed',href:paymentHref(candidate.transactionId)})),
        href:`/acuity/appointments/${row.appointmentId}`})),
      unaccountedPayments:state.totals?.credits.slice(0,100) ?? [],warning:'The yearly unaccounted PayNow pool is not attributed to individual clients. Invoice extras are not included in Acuity costs.'},
      sources:[{label:`${year} saved Unsettled results`,href:`/reconciliation/unsettled?year=${year}`},...allBookings.slice(0,12).map(row=>({label:`${row.client} · ${row.appointmentDate.slice(0,10)}`,href:`/acuity/appointments/${row.appointmentId}`})),
        ...payments.slice(0,7).map(payment=>({label:`Matched PayNow payment ${payment.id}`,href:paymentHref(payment.id)!}))] };
  }
  if (name === 'query_studio_report') {
    if (typeof args.question !== 'string' || args.question.length > 4000) throw new Error('Use a short report question.');
    const raw = await extractSemanticQuery(args.question);
    const validated = validateAndNormalizeSemanticQuery(raw,args.question,parseDateMention(args.question));
    if (validated.type==='clarification') return {data:validated,sources:[]};
    const scopedQueries=isComparisonQuery(validated.query)?validated.query.queries:[validated.query];
    for (const query of scopedQueries) if (query.domain==='acuity' && query.filters?.searchText) {
      const profile=await getCustomerProfile(query.filters.searchText);
      if (profile.needsClarification) return {data:{type:'clarification',question:'Several customers match that name. Which email or phone should I use?',matches:profile.matches},sources:[]};
      if (profile.found && profile.customer) query.filters.customerKey=profile.customer.identity;
    }
    const result = await executeSemanticQuery(validated.query);
    const rendered=renderAnswer(validated.query,result);
    const table=studioReportTable(rendered.columns,rendered.rows);
    const queries=isComparisonQuery(validated.query)?validated.query.queries:[validated.query];
    const scopes=queries.map(query=>`${query.domain==='acuity'?'Acuity booking value is not confirmed bank receipts. Unavailable costs indicate missing saved prices; complete totals cannot be established.':'Raw bank movements include transfers and items ignored for reconciliation.'} ${query.dateRange?`Period: ${query.dateRange.startDate} to ${new Date(Date.parse(query.dateRange.endDateExclusive)-86400000).toISOString().slice(0,10)}.`:'Coverage: all stored records.'}`);
    return {data:{report:{answer:[rendered.answer,...new Set(scopes)].join('\n\n'),table}},sources:[]};
  }
  throw new Error('Unknown studio tool.');
}
