import {sql} from '@/lib/db';

export async function findCustomerContacts(search:string, source:'customers'|'bookings'|'both'='both') {
  if (!search.trim() || search.length>200) throw new Error('Enter a customer name, email or phone.');
  const digits=search.replace(/\D/g,'');
  const isPhone=/^[+\d\s()-]+$/.test(search) && digits.length>=8;
  const phone=digits.length===8?'65'+digits:digits;
  const isEmail=search.includes('@');
  const words=search.toLowerCase().match(/[a-z0-9]+/g)??[];
  const filter=isPhone?sql`(normalized_phone=${phone} or normalized_saved_phone=${phone})`:isEmail
    ?sql`lower(trim(${search}))=any(regexp_split_to_array(lower(coalesce(email,'')),'[[:space:]]*[,;][[:space:]]*'))`
    :words.reduce((where,word)=>sql`${where} and concat_ws(' ',name,email) ilike ${'%'+word+'%'}`,sql`true`);
  type Contact={source:string;id:string;name:string;email:string|null;phone:string|null;normalized_phone:string|null;saved_normalized_phone:string|null;last_session:string|null};
  const rows=await sql<{customer_records:number;booking_records:number;contact_count:number;phones:string[];saved_customer_phones:string[];contacts:Contact[]}[]>`
    with raw_contacts as (
      select 'Customer record'::text as source,c.id::text as id,trim(concat_ws(' ',c.first_name,c.last_name)) as name,c.email,c.phone,
        to_jsonb(c)->>'normalized_phone' as saved_normalized_phone,null::timestamptz as last_session
      from acuity_clients c where ${source}!='bookings'
      union all
      select 'Booking contact',a.acuity_appointment_id::text,trim(concat_ws(' ',a.client_first_name,a.client_last_name)),a.client_email,a.client_phone,
        null::text,a.appointment_datetime from acuity_appointments a where ${source}!='customers'
    ), normalized as (
      select *,regexp_replace(coalesce(nullif(trim(phone),''),saved_normalized_phone,''),'[^0-9]','','g') as digits,
        regexp_replace(coalesce(saved_normalized_phone,''),'[^0-9]','','g') as saved_digits from raw_contacts
    ), matched as (
      select * from (select *,nullif(case when length(digits)=8 then '65'||digits else digits end,'') as normalized_phone,
        nullif(case when length(saved_digits)=8 then '65'||saved_digits else saved_digits end,'') as normalized_saved_phone from normalized) n where ${filter}
    ), contacts as (
      select distinct on(source,name,email,normalized_phone) source,id,name,email,phone,normalized_phone,saved_normalized_phone,last_session::text
      from matched order by source,name,email,normalized_phone,last_session desc nulls last,id
    ), distinct_phones as (
      select distinct source,unnest(array[normalized_phone,normalized_saved_phone]) as phone from matched
    ) select count(*) filter(where source='Customer record')::int as customer_records,
      count(*) filter(where source='Booking contact')::int as booking_records,
      (select count(*)::int from contacts) as contact_count,
      coalesce((select array_agg(distinct phone) from distinct_phones where phone is not null),'{}') as phones,
      coalesce((select array_agg(distinct phone) from distinct_phones where phone is not null and source='Customer record'),'{}') as saved_customer_phones,
      coalesce((select jsonb_agg(c) from (select * from contacts order by source,name,email,normalized_phone limit 100) c),'[]'::jsonb) as contacts
    from matched`;
  return rows[0];
}
