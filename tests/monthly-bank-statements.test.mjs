import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {loadTs} from './ts-loader.mjs';
import {fixtureSql} from './sql-fixture.mjs';

const db=new PGlite();const sql=fixtureSql(db);
const overrides={'@/lib/db':{sql},'server-only':{}};
const {getMonthlyBankStatement,monthDates,statementCoverage}=loadTs('lib/monthly-bank-statements.ts',overrides);
await db.exec(`CREATE TABLE bank_statement_uploads(id bigint PRIMARY KEY,account_number text,currency text,statement_start_date date,statement_end_date date,opening_balance numeric,ledger_balance numeric,uploaded_at timestamptz default now());
CREATE TABLE bank_transactions(id bigint PRIMARY KEY,upload_id bigint,transaction_date date,value_date date,description_1 text,description_2 text,credit numeric,debit numeric,running_balance numeric);
INSERT INTO bank_statement_uploads(id,account_number,currency,statement_start_date,statement_end_date,opening_balance,ledger_balance) VALUES
 (1,'A','SGD','2026-09-01','2026-09-30',1000,1070),(2,'A','SGD','2026-10-01','2026-10-13',970,1080),
 (3,'B','USD','2026-09-01','2026-09-30',500,1000),(4,'A','SGD','2026-11-01','2026-11-30',1080,1080);
INSERT INTO bank_transactions VALUES
 (1,1,'2026-09-01','2026-09-01','Bank charge','expense',null,30,970),
 (2,1,'2026-09-30','2026-09-30','IRAS','tax-related credit',100,null,1070),
 (3,2,'2026-09-30','2026-09-30','IRAS','tax-related credit',100,null,1070),
 (4,2,'2026-10-01','2026-10-01','Payment','outgoing',null,20,1050),
 (5,2,'2026-10-13','2026-10-13','Mohith Karanth','owner credit',30,null,1080),
 (6,3,'2026-09-01','2026-09-01','Credit','USD',500,null,1000);`);
try {
  const september=await getMonthlyBankStatement('2026-09','A|SGD');
  assert.equal(september.rows.length,2);assert.equal(september.creditCents,10000);assert.equal(september.debitCents,3000);assert.equal(september.netCents,7000);
  assert.equal(september.openingCents,100000);assert.equal(september.closingCents,107000);assert.equal(september.balanceDifferenceCents,0);assert.equal(september.complete,true);
  console.log('PASS: calendar dates across files; duplicate September credit counted once; all credits including IRAS retained; blank debit/credit fields do not erase net movement');
  const october=await getMonthlyBankStatement('2026-10','A|SGD');
  assert.equal(october.rows.length,2);assert.equal(october.creditCents,3000);assert.equal(october.debitCents,2000);assert.equal(october.netCents,1000);
  assert.equal(october.openingCents,107000);assert.equal(october.closingCents,108000);assert.equal(october.balanceDifferenceCents,0);
  assert.equal(october.complete,false);assert.equal(october.coverageEnd,'2026-10-13');assert.ok(october.warnings.some(w=>w.includes('Partial')));
  console.log('PASS: October excludes September boundary rows; includes owner funding; opening balance comes from October activity rather than an ambiguous file header; partial coverage labeled');
  const dollars=await getMonthlyBankStatement('2026-09','B|USD');
  assert.equal(dollars.rows.length,1);assert.equal(dollars.creditCents,50000);assert.equal(dollars.openingCents,50000);assert.equal(dollars.closingCents,100000);
  const noRows=await getMonthlyBankStatement('2026-11','A|SGD');
  assert.equal(noRows.rows.length,0);assert.equal(noRows.openingCents,108000);assert.equal(noRows.closingCents,108000);
  const missing=await getMonthlyBankStatement('2026-12','A|SGD');
  assert.equal(missing.openingCents,null);assert.equal(missing.closingCents,null);assert.equal(missing.complete,false);
  console.log('PASS: separate accounts/currencies, verified zero-movement statements, and missing balances kept unavailable');
  assert.equal(monthDates('2024-02').last,'2024-02-29');assert.equal(monthDates('2026-12').end,'2027-01-01');
  assert.equal(statementCoverage('2026-09-01','2026-09-30',[{from:'2026-09-01',to:'2026-09-10'},{from:'2026-09-12',to:'2026-09-30'}]).complete,false);
  await assert.rejects(getMonthlyBankStatement('2026-13'));await assert.rejects(getMonthlyBankStatement('2026-09','missing|SGD'));
  await db.exec("UPDATE bank_transactions SET running_balance=1090 WHERE id=5");
  const mismatch=await getMonthlyBankStatement('2026-10','A|SGD');assert.equal(mismatch.balanceDifferenceCents,1000);assert.ok(mismatch.warnings.some(w=>w.includes('do not agree')));
  console.log('PASS: leap years, year rollover, coverage gaps, invalid inputs and balance discrepancies');
  await db.exec("INSERT INTO bank_statement_uploads VALUES (5,'A','SGD','2026-08-01','2026-08-31',0,103,now())");
  for(let i=0;i<103;i++)await db.query("INSERT INTO bank_transactions VALUES ($1,5,'2026-08-01','2026-08-01',$2,'',1,null,$3)",[100+i,`Credit ${i+1}`,i+1]);
  const full=await getMonthlyBankStatement('2026-08','A|SGD');assert.equal(full.rows.length,103);assert.equal(full.creditCents,10300);assert.equal(full.openingCents,0);assert.equal(full.closingCents,10300);
  console.log('PASS: all monthly rows returned beyond 100, with summary totals matching every row');
  const {GET}=loadTs('app/api/bank-statements/summary/route.ts',{...overrides,'@/lib/studio-auth-request':{authorizeApiRequest:async()=>null}});
  const uploaded=await (await GET(new Request('https://studio.test/api/bank-statements/summary?uploadId=2'))).json();
  assert.equal(Number(uploaded.latest.net_amount),110);
  console.log('PASS: existing upload summary net is corrected for nullable fields');
}finally{await db.close();}
