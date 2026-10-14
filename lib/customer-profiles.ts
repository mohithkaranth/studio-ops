import {CUSTOMER_IDENTITY_SQL} from '@/lib/customer-identity';
import 'server-only';
import { sql } from '@/lib/db';
import { customerProfileFields } from '@/lib/customer-profile-fields';

type Candidate = {identity:string;clientId:number|null;bookingId:string|null;firstName:string|null;lastName:string|null;email:string|null;phone:string|null;raw:unknown;matches:number};
export async function getCustomerProfile(search: string) {
  const terms = search.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!terms.length || search.length > 200) throw new Error('Use a customer name, email or phone number.');
  const filter = search.includes('@') ? sql`lower(trim(${search}))=any(regexp_split_to_array(lower(coalesce(email,'')),'[[:space:]]*[,;][[:space:]]*'))`
    : /^[+\d\s()-]+$/.test(search) ? sql`case when length(regexp_replace(coalesce(phone,''),'[^0-9]','','g'))=8 then '65'||regexp_replace(coalesce(phone,''),'[^0-9]','','g') else regexp_replace(coalesce(phone,''),'[^0-9]','','g') end=${search.replace(/\D/g,'').length===8?'65'+search.replace(/\D/g,''):search.replace(/\D/g,'')}`
    : terms.reduce((condition,term)=>sql`${condition} and concat_ws(' ',first_name,last_name,email,phone,booking_id) ilike ${'%'+term+'%'}`,sql`true`);
  const matches = await sql<Candidate[]>`
    with raw_candidates as (
      select coalesce('email:'||nullif(lower(trim(split_part(replace(email,';',','),',',1))),''),'phone:'||nullif(case when length(regexp_replace(phone,'[^0-9]','','g'))=8 then '65'||regexp_replace(phone,'[^0-9]','','g') else regexp_replace(phone,'[^0-9]','','g') end,''),'client:'||id::text) as identity,
        id as client_id,null::text as booking_id,first_name,last_name,email,phone,raw_json,0 as priority,null::timestamptz as session_date
      from acuity_clients
      union all
      select ${sql.unsafe(CUSTOMER_IDENTITY_SQL)} as identity,null::bigint as client_id,acuity_appointment_id::text as booking_id,
        client_first_name,client_last_name,client_email,client_phone,raw_json,1 as priority,appointment_datetime as session_date
      from acuity_appointments
    ), candidates as (
      select distinct on(identity) * from raw_candidates order by identity,priority,session_date desc nulls last,booking_id
    ) select identity,client_id as "clientId",booking_id as "bookingId",first_name as "firstName",last_name as "lastName",email,phone,raw_json as raw,count(*) over()::int as matches
      from candidates where ${filter} order by identity limit 11`;
  if (!matches.length) return {found:false,availableFields:['Name','Email','Phone','Booking history','Saved notes and booking-form answers'],message:'No stored customer matched this search.'};
  if (matches[0].matches > 1) return {found:false,needsClarification:true,matchCount:matches[0].matches,
    matches:matches.slice(0,10).map(item=>({name:[item.firstName,item.lastName].filter(Boolean).join(' '),email:item.email,phone:item.phone,bookingId:item.bookingId})),
    message:'Several stored customers matched. Ask which customer/email they mean before retrieving full profile details.'};
  const customer = matches[0];
  const name = [customer.firstName,customer.lastName].filter(Boolean).join(' ') || customer.email || 'Unknown customer';
  const belongs = sql`${sql.unsafe(CUSTOMER_IDENTITY_SQL)}=${customer.identity}`;
  const summary = await sql<{bookingCount:number;cancelledCount:number;acuityCostCents:string;missingCosts:number;firstSession:string|null;lastSession:string|null;latestCompletedSession:string|null}[]>`
    select count(*) filter(where coalesce(a.canceled,false)=false)::int as "bookingCount",count(*) filter(where a.canceled=true)::int as "cancelledCount",
      coalesce(sum(round(a.price*100)) filter(where coalesce(a.canceled,false)=false),0)::text as "acuityCostCents",
      count(*) filter(where a.price is null and coalesce(a.canceled,false)=false)::int as "missingCosts",
      min(a.appointment_datetime)::text as "firstSession",max(a.appointment_datetime)::text as "lastSession",
      max(a.appointment_datetime) filter(where a.appointment_datetime<=now() and coalesce(a.canceled,false)=false)::text as "latestCompletedSession"
    from acuity_appointments a where (${belongs})`;
  const bookings = await sql<{id:string;date:string;createdDate:string|null;type:string|null;room:string|null;price:string|null;cancelled:boolean|null;raw:unknown}[]>`
    select a.acuity_appointment_id::text as id,a.appointment_datetime::text as date,a.created_datetime::text as "createdDate",a.appointment_type_name as type,
      a.calendar_name as room,a.price::text,a.canceled as cancelled,a.raw_json as raw
    from acuity_appointments a where (${belongs}) order by a.appointment_datetime desc,a.acuity_appointment_id limit 30`;
  return {found:true,customer:{identity:customer.identity,name,email:customer.email,phone:customer.phone,...customerProfileFields(customer.raw)},
    history:{...summary[0],acuityCostCents:summary[0].missingCosts ? null : Number(summary[0].acuityCostCents)},
    bookings:bookings.map(booking=>({id:booking.id,date:booking.date,createdDate:booking.createdDate,type:booking.type,room:booking.room,price:booking.price,cancelled:booking.cancelled,
      ...customerProfileFields(booking.raw),href:`/acuity/appointments/${booking.id}`})),
    limitations:'Contact information and notes are saved data, not a live Acuity client lookup. Notes and form answers are from saved booking records and may vary by booking. Missing fields mean not stored, not that the customer supplied nothing. History covers all stored sessions, including future bookings, with up to 30 latest records shown. Acuity value is not proof of money received.'};
}
