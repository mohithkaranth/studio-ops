import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './ts-loader.mjs';
import {fixtureSql} from './sql-fixture.mjs';

const db=new PGlite();
const sql=fixtureSql(db);
const overrides={'@/lib/db':{sql},'server-only':{}};
const {buildAggregateQuery,buildRowsQuery,buildRowSummaryQuery}=loadTs('app/api/studio-chat/sql-builder.ts',overrides);
const {executeSemanticQuery}=loadTs('app/api/studio-chat/result-shaper.ts',overrides);
const {runStudioTool}=loadTs('app/api/studio-chat/studio-tools.ts',overrides);
const {getCustomerAnalytics}=loadTs('lib/customer-analytics.ts',overrides);
const {findCustomerContacts}=loadTs('lib/customer-contacts.ts',overrides);
await db.exec(`CREATE TABLE bank_statement_uploads(id bigint PRIMARY KEY,account_number text,currency text);
 CREATE TABLE bank_transactions(id bigint PRIMARY KEY,upload_id bigint,transaction_date date,value_date date,description_1 text,description_2 text,credit numeric,debit numeric,running_balance numeric,amount numeric,transaction_type text,payment_channel text,counterparty_name text,reference_text text);
 CREATE TABLE acuity_clients(id bigint PRIMARY KEY,first_name text,last_name text,email text,phone text,normalized_email text,raw_json jsonb);
 CREATE TABLE acuity_appointments(id bigint,acuity_appointment_id text PRIMARY KEY,client_id bigint,client_first_name text,client_last_name text,client_email text,client_phone text,appointment_datetime timestamptz,created_datetime timestamptz,appointment_type_name text,calendar_name text,price numeric,canceled boolean,paid_status text,certificate_code text,raw_json jsonb);
 INSERT INTO bank_statement_uploads VALUES (1,'A','SGD'),(2,'A','sgd'),(3,'B','SGD'),(4,'A','USD');
 INSERT INTO bank_transactions(id,upload_id,transaction_date,value_date,description_1,description_2,credit,debit,running_balance) VALUES
 (1,1,'2026-01-01','2026-01-01','PAYNOW','credit',100,0,1000),(2,2,'2026-01-01','2026-01-01','PAYNOW','credit',100,0,1000),
 (3,1,'2026-01-02','2026-01-02','Expense','debit',0,20,980),(4,2,'2026-01-02','2026-01-02','Expense','debit',0,20,980),
 (5,1,'2026-01-02','2026-01-02','Expense','debit',0,30,980),(6,4,'2026-01-01','2026-01-01','PAYNOW','credit',999,0,1000),
 (7,3,'2026-01-01','2026-01-01','PAYNOW','credit',100,0,1000),(8,1,'2026-01-01','2026-01-01','Malformed','both',100,10,1000);`);
const base={domain:'bank',metrics:['bank_credits','bank_debits','net_movement','transaction_count'],dimensions:[],resultMode:'aggregate_only',rowLimit:0};
try {
  const aggregate=(await buildAggregateQuery(base))[0];
  assert.equal(Number(aggregate.bank_credits),200);assert.equal(Number(aggregate.bank_debits),50);assert.equal(Number(aggregate.net_movement),150);assert.equal(Number(aggregate.transaction_count),4);
  const credits=await runStudioTool('find_bank_payments',{searchTerms:[],startDate:null,endDateExclusive:null});
  const debits=await runStudioTool('find_bank_debits',{searchTerms:[],startDate:null,endDateExclusive:null});
  assert.equal(credits.data.totalCents,Number(aggregate.bank_credits)*100);
  assert.equal(debits.data.totalCents,Number(aggregate.bank_debits)*100);
  const monthly=await buildAggregateQuery({...base,dimensions:['month']});
  assert.equal(Number(monthly[0].bank_credits),200);
  const rowsQuery={...base,resultMode:'aggregate_with_rows',rowLimit:100};
  assert.equal((await buildRowsQuery(rowsQuery)).length,4);
  assert.equal(Number((await buildRowSummaryQuery(rowsQuery))[0].net_movement),150);
  const bankComparison=await executeSemanticQuery({kind:'comparison',queries:[{...base,metrics:['bank_credits','transaction_count']},{...base,metrics:['bank_debits','transaction_count']}],joinBy:[],resultMode:'aggregate_only'});
  assert.equal(bankComparison.aggregateRows[0].bank_credit_transaction_count,2);
  assert.equal(bankComparison.aggregateRows[0].bank_debit_transaction_count,2);
  console.log('PASS: direct searches, aggregate/monthly reports, row lists and summaries agree; duplicate uploads, other currencies and malformed rows are excluded; distinct accounts/debit amounts retained');

  let id=0;
  const insert=async(name,email,phone,date,price=100)=>{await db.query(`INSERT INTO acuity_appointments(id,acuity_appointment_id,client_first_name,client_last_name,client_email,client_phone,appointment_datetime,created_datetime,appointment_type_name,calendar_name,price,canceled,raw_json) VALUES ($1,$2,$3,'',$4,$5,$6,$6,'Rehearsal','Living Room',$7,false,'{}')`,[++id,String(id),name,email,phone,date,price]);};
  await insert('Old Name',' USER@EXAMPLE.TEST ',null,'2020-01-05');
  await insert('Old Name','user@example.test',null,'2020-01-20');
  await insert('New Name','user@example.test',null,'2020-02-05');
  await insert('New Name','user@example.test, someoneelse@example.test',null,'2020-02-20');
  await insert('New Name','other@example.test',null,'2020-02-20');
  await insert('Phone Old',null,'+65 8123-4567','2020-01-05');
  await insert('Phone New',' ','6581234567','2020-02-05');
  const customerQuery={domain:'acuity',metrics:['booking_count','client_count','booking_value'],dimensions:[],resultMode:'aggregate_only',rowLimit:0};
  assert.equal(Number((await buildAggregateQuery(customerQuery))[0].client_count),3);
  const grouped=await buildAggregateQuery({...customerQuery,dimensions:['client_name']});
  assert.equal(grouped.length,3);assert.equal(grouped.find(row=>row.client_name.includes('user@example.test')).booking_count,4);
  const top=await runStudioTool('get_client_booking_report',{startDate:'2020-01-01',endDateExclusive:'2020-03-01',limit:100,rankBy:'booking_count',dateBasis:'appointment_datetime'});
  assert.equal(top.data.report.table.rows.length,3);assert.equal(top.data.report.table.rows[0].bookings,4);
  const profile=await runStudioTool('get_customer_profile',{search:'user@example.test'});
  assert.equal(profile.data.history.bookingCount,4);
  const bookingSearch=await runStudioTool('find_acuity_bookings',{client:'user@example.test',startDate:null,endDateExclusive:null});
  assert.equal(bookingSearch.data.count,4);
  const ambiguous=await runStudioTool('find_acuity_bookings',{client:'New Name',startDate:null,endDateExclusive:null});
  assert.equal(ambiguous.data.needsClarification,true);
  const allBookings=await runStudioTool('find_acuity_bookings',{client:'New Name',startDate:null,endDateExclusive:null,allMatches:true});
  assert.equal(allBookings.data.count,5);
  const phone=await runStudioTool('get_customer_profile',{search:'+65 8123 4567'});
  assert.equal(phone.data.history.bookingCount,2);
  console.log('PASS: customer counts, grouped reports, top clients, profiles and booking searches use the same email/phone identity; ambiguous names require clarification');

  const settings={fromMonth:'2020-01',toMonth:'2020-02',averageBookings:2,inactiveMonths:3,minimumLifetimeBookings:1};
  const page=await getCustomerAnalytics(settings);
  const chat=await runStudioTool('get_customer_analytics',settings);
  assert.equal(page[0].lost_customers,1);assert.equal(chat.data.report.table.rows.length,1);
  assert.equal(chat.data.report.table.rows[0].bookings,page[0].total_bookings);
  assert.ok(chat.sources[0].href.includes('fromMonth=2020-01'));
  await assert.rejects(runStudioTool('get_customer_analytics',{...settings,toMonth:'2999-01'}));
  console.log('PASS: chat lost-customer results match the exact page calculation and preserve filter links; invalid periods rejected');

  await insert('New Name','user@example.test',null,'2020-02-21',null);
  const incomplete=await buildAggregateQuery(customerQuery);
  assert.equal(incomplete[0].booking_value,null);
  const comparison=await executeSemanticQuery({kind:'comparison',queries:[customerQuery,{...base,metrics:['bank_credits']}],joinBy:[],resultMode:'aggregate_only'});
  assert.equal(comparison.aggregateRows[0].acuity_booking_value,null);
  console.log('PASS: missing Acuity prices remain unavailable in totals and bank comparisons, rather than becoming zero');

  await db.exec(`ALTER TABLE acuity_clients ADD COLUMN normalized_phone text;
    INSERT INTO acuity_clients VALUES (1,'Edalin','Ching','connect@example.test','+65 9771 1200','connect@example.test','{}','+6597711200'),
      (2,'Edalin','Ching','connect@example.test, secondary@example.test','+65 9771 1200','connect@example.test, secondary@example.test','{}','+6588604718'),
      (3,'Other','Person','secondary@example.test','+65 8000 1111','secondary@example.test','{}','+6580001111');`);
  await insert('Edalin Ching','connect@example.test, secondary@example.test','88604718','2020-03-01');
  const contact=await findCustomerContacts('Edalin','both');
  assert.equal(contact.customer_records,2);assert.equal(contact.booking_records,1);
  assert.deepEqual(contact.saved_customer_phones.sort(),['6588604718','6597711200']);
  assert.ok(contact.contacts.every(row=>row.name==='Edalin Ching'));
  const local=await findCustomerContacts('88604718','both');
  const international=await findCustomerContacts('+65 8860 4718','both');
  assert.deepEqual(local,international);
  const onlyClients=await runStudioTool('find_customer_contacts',{search:'Edalin',source:'customers'});
  assert.equal(onlyClients.data.customer_records,2);assert.equal(onlyClients.data.booking_records,0);
  assert.ok(onlyClients.data.report.answer.includes('+6588604718'));
  const alias=await findCustomerContacts('connect@example.test','customers');
  assert.equal(alias.customer_records,2);
  console.log('PASS: transcript regression — all named customer records and booking phones are inspected without secondary-email substitution; local/+65 phone searches agree; customer-only lookups expose both saved phones');
} finally {await db.close();}
