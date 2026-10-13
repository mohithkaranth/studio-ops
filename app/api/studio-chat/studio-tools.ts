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

export type EvidenceLink = { label: string; href: string };
export type ToolResult = { data: unknown; sources: EvidenceLink[] };
type Args = Record<string, unknown>;
const nullableString = { type: ['string', 'null'] };
function tool(name: string, description: string, properties: Record<string, unknown>) {
  return { type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } };
}
export const studioTools = [
  tool('get_customer_profile', 'Find a stored customer profile by name, email or phone. Returns available contact details, full-history counts and Acuity value, plus saved notes/form answers from up to 30 latest bookings. If several people match, ask for clarification and do not merge their details. Missing notes/forms mean not stored. This uses stored database records and does not fetch invoices.', {search:{type:'string'}}),
  tool('find_bank_payments', 'Search actual incoming SGD bank credits. Returns exact count and total over ALL matches, up to 100 evidence rows and their ignored/matched/allocated status. Multiple payer terms are OR; use separate calls for per-payer totals. Raw bank searches include ignored credits; use get_reconciliation_results for unsettled totals.', {
    searchTerms: { type: 'array', items: { type: 'string' }, maxItems: 8 }, startDate: nullableString, endDateExclusive: nullableString,
  }),
  tool('find_bank_debits', 'Search actual outgoing SGD bank debits: expenses, spending, withdrawals and payments to vendors or people. Returns exact count and total over ALL matches and up to 100 evidence rows with bank links. Use an empty searchTerms array for all debits. Multiple vendor terms are OR; use separate calls for per-vendor totals. Debit amounts are positive amounts spent. Credit reconciliation exclusions do not apply to outgoing debits.', {
    searchTerms: { type: 'array', items: { type: 'string' }, maxItems: 8 }, startDate: nullableString, endDateExclusive: nullableString,
  }),
  tool('find_acuity_bookings', 'Find a client’s non-cancelled Acuity bookings and sum their actual Acuity prices. Date range is Singapore session dates. Returns count, total and up to 100 bookings with links, creation dates and package codes. Acuity paid flags alone are not proof of bank settlement.', {
    client: nullableString, startDate: nullableString, endDateExclusive: nullableString,
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
    const search = typeof args.client === 'string' && args.client.trim() ? pattern(args.client) : null;
    const result = await sql<{ count: number; totalCents: string; missingPrices: number; records: Record<string, unknown>[] }[]>`
      with bookings as (select acuity_appointment_id::text as id, concat_ws(' ',client_first_name,client_last_name) as client,
        client_email, appointment_datetime, created_datetime, appointment_type_name, calendar_name, price, paid_status, certificate_code
        from acuity_appointments where coalesce(canceled,false)=false
          and (${start}::date is null or appointment_datetime >= (${start}::date::timestamp at time zone 'Asia/Singapore'))
          and (${end}::date is null or appointment_datetime < (${end}::date::timestamp at time zone 'Asia/Singapore'))
          and (${search}::text is null or concat_ws(' ',client_first_name,client_last_name,client_email) ilike ${search}))
      select count(*)::int as count, coalesce(sum(round(price*100)),0)::text as "totalCents", count(*) filter(where price is null)::int as "missingPrices",
        coalesce((select jsonb_agg(r) from (select * from bookings order by appointment_datetime,id limit 100) r),'[]'::jsonb) as records from bookings`;
    const data = result[0];
    return { data: {...data,totalCents:Number(data.totalCents),records:data.records.map(row=>({...row,href:`/acuity/appointments/${row.id}`}))},sources:data.records.map(row=>({label:`${row.client} · ${String(row.appointment_datetime).slice(0,10)} · ${row.appointment_type_name}`,href:`/acuity/appointments/${row.id}`})) };
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
    const result = await executeSemanticQuery(validated.query);
    return {data:{...renderAnswer(validated.query,result),resolvedQuery:validated.query},sources:[]};
  }
  throw new Error('Unknown studio tool.');
}
