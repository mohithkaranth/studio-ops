import 'server-only';
import { sql } from '@/lib/db';
import { customerProfileFields } from '@/lib/customer-profile-fields';

type Candidate = {identity:string;clientId:number|null;bookingId:string|null;firstName:string|null;lastName:string|null;email:string|null;phone:string|null;raw:unknown;matches:number};
export async function getCustomerProfile(search: string) {
  const terms = search.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  if (!terms.length || search.length > 200) throw new Error('Use a customer name, email or phone number.');
  const filter = search.includes('@') ? sql`lower(trim(email))=lower(trim(${search}))`
    : /^[+\d\s()-]+$/.test(search) ? sql`regexp_replace(coalesce(phone,''),'[^0-9]','','g')=${search.replace(/\D/g,'')}`
    : terms.reduce((condition,term)=>sql`${condition} and concat_ws(' ',first_name,last_name,email,phone,booking_id) ilike ${'%'+term+'%'}`,sql`true`);
  const matches = await sql<Candidate[]>`
    with candidates as (
      select 'client:' || id::text as identity,id as client_id,null::text as booking_id,first_name,last_name,email,phone,raw_json
      from acuity_clients
      union all
      (select distinct on (coalesce(nullif(lower(trim(a.client_email)),''),nullif(a.client_phone,''),a.acuity_appointment_id::text),lower(concat_ws(' ',a.client_first_name,a.client_last_name)))
        'booking:' || a.acuity_appointment_id::text,null::bigint,a.acuity_appointment_id::text,a.client_first_name,a.client_last_name,a.client_email,a.client_phone,a.raw_json
      from acuity_appointments a where a.client_id is null
        and not exists(select 1 from acuity_clients c where nullif(lower(trim(a.client_email)),'')=c.normalized_email)
      order by coalesce(nullif(lower(trim(a.client_email)),''),nullif(a.client_phone,''),a.acuity_appointment_id::text),lower(concat_ws(' ',a.client_first_name,a.client_last_name)),a.appointment_datetime desc)
    ) select identity,client_id as "clientId",booking_id as "bookingId",first_name as "firstName",last_name as "lastName",email,phone,raw_json as raw,count(*) over()::int as matches
      from candidates where ${filter} order by identity limit 11`;
  if (!matches.length) return {found:false,availableFields:['Name','Email','Phone','Booking history','Saved notes and booking-form answers'],message:'No stored customer matched this search.'};
  if (matches[0].matches > 1) return {found:false,needsClarification:true,matchCount:matches[0].matches,
    matches:matches.slice(0,10).map(item=>({name:[item.firstName,item.lastName].filter(Boolean).join(' '),email:item.email,bookingId:item.bookingId})),
    message:'Several stored customers matched. Ask which customer/email they mean before retrieving full profile details.'};
  const customer = matches[0];
  const name = [customer.firstName,customer.lastName].filter(Boolean).join(' ') || customer.email || 'Unknown customer';
  const belongs = customer.clientId !== null ? sql`a.client_id=${customer.clientId} or (${customer.email}::text is not null and lower(trim(a.client_email))=lower(trim(${customer.email}::text)))`
    : customer.email ? sql`lower(trim(a.client_email))=lower(trim(${customer.email}))`
    : customer.phone ? sql`a.client_phone=${customer.phone} and lower(concat_ws(' ',a.client_first_name,a.client_last_name))=lower(${name})`
    : sql`a.acuity_appointment_id::text=${customer.bookingId}`;
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
  return {found:true,customer:{name,email:customer.email,phone:customer.phone,...customerProfileFields(customer.raw)},
    history:{...summary[0],acuityCostCents:summary[0].missingCosts ? null : Number(summary[0].acuityCostCents)},
    bookings:bookings.map(booking=>({id:booking.id,date:booking.date,createdDate:booking.createdDate,type:booking.type,room:booking.room,price:booking.price,cancelled:booking.cancelled,
      ...customerProfileFields(booking.raw),href:`/acuity/appointments/${booking.id}`})),
    limitations:'Contact information and notes are saved data, not a live Acuity client lookup. Notes and form answers are from saved booking records and may vary by booking. Missing fields mean not stored, not that the customer supplied nothing. History covers all stored sessions, including future bookings, with up to 30 latest records shown. Acuity value is not proof of money received.'};
}
