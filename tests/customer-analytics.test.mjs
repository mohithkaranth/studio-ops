import {loadTs} from './ts-loader.mjs';
import {fixtureSql} from './sql-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {PGlite} from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const db = new PGlite();
await db.exec(`CREATE TABLE acuity_appointments (
  acuity_appointment_id text PRIMARY KEY, client_first_name text, client_last_name text,
  client_email text, client_phone text, appointment_datetime timestamptz, canceled boolean
)`);
let rows;
const sql = fixtureSql(db, result => {rows=result;});
const controls = () => null;
const jsx = (type, props) => ({type, props});
const pageModule = {exports: {}};
const source = fs.readFileSync(new URL('../app/customer-analytics/page.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
}}).outputText;
new Function('require', 'module', 'exports', compiled)(id => {
  if (id === '@/lib/studio-auth-request') return {requireStudioSession: async () => {}};
  if (id === './CustomerAnalyticsControls') return {default: controls};
  if (id === 'react/jsx-runtime') return {jsx, jsxs: jsx};
  if (id === '@/lib/customer-analytics') return loadTs('lib/customer-analytics.ts',{'@/lib/db':{sql}});
  return require(id);
}, pageModule, pageModule.exports);

let sequence = 0;
const insert = async ({name='Sample Customer', email=null, phone=null, date='2020-01-05T12:00:00+08', canceled=false}) => {
  const [first, ...rest] = name.split(' ');
  await db.query('INSERT INTO acuity_appointments VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [String(++sequence), first, rest.join(' '), email, phone, date, canceled]);
};
const historical = async (customer) => {
  for (const date of ['2020-01-05','2020-01-20','2020-02-05','2020-02-20']) {
    await insert({...customer, date: `${date}T12:00:00+08`});
  }
};
const analyse = async (averageBookings='2') => {
  const tree = await pageModule.exports.default({searchParams: Promise.resolve({
    analysed:'1', fromMonth:'2020-01', toMonth:'2020-02', averageBookings,
    inactiveMonths:'3', minimumLifetimeBookings:'1',
  })});
  const walk = node => Array.isArray(node) ? node.flatMap(walk) : node && typeof node === 'object'
    ? [node, ...walk(node.props?.children)] : [];
  const exportProps = walk(tree).find(node => node.type === controls).props;
  const lost = rows.filter(row => row.customer_key);
  assert.equal(exportProps.results.length, lost.length, 'Export and visible rows agree');
  assert.equal(rows[0].lost_customers, lost.length, 'Summary and visible rows agree');
  return lost;
};
try {
  await historical({name:'Same Name', email:'lost@example.test'});
  await historical({name:'Same Name', email:'active@example.test'});
  await insert({name:'Same Name', email:'active@example.test', date:new Date(Date.now()-86400000).toISOString()});
  let lost = await analyse();
  assert.equal(rows[0].customers_analysed, 2);
  assert.equal(lost.length, 1);
  assert.equal(lost[0].email, 'lost@example.test');
  console.log('PASS: identical names with different emails remain separate; activity belongs to the right customer');

  await db.exec('TRUNCATE acuity_appointments');
  await insert({name:'Old Spelling', email:' PERSON@Example.Test ', date:'2020-01-05T12:00:00+08'});
  await insert({name:'Old Spelling', email:'person@example.test', date:'2020-01-20T12:00:00+08'});
  await insert({name:'New Spelling', email:'person@example.test', date:'2020-02-05T12:00:00+08'});
  await insert({name:'New Spelling', email:'person@example.test', date:'2020-02-20T12:00:00+08'});
  lost = await analyse();
  assert.equal(lost.length, 1);
  assert.equal(lost[0].total_bookings, 4);
  assert.equal(lost[0].client, 'New Spelling');
  assert.equal(Number(lost[0].average_bookings_per_month), 2);
  console.log('PASS: email case/whitespace and changed names combine; latest name is displayed');

  await db.exec('TRUNCATE acuity_appointments');
  await insert({name:'Phone Old', email:' ', phone:'+65 8123-4567', date:'2020-01-05T12:00:00+08'});
  await insert({name:'Phone Old', phone:'(65)81234567', date:'2020-01-20T12:00:00+08'});
  await insert({name:'Phone New', phone:'6581234567', date:'2020-02-05T12:00:00+08'});
  await insert({name:'Phone New', phone:'+65 8123 4567', date:'2020-02-20T12:00:00+08'});
  lost = await analyse();
  assert.equal(lost.length, 1);
  assert.equal(lost[0].customer_key, 'phone:6581234567');
  assert.equal(lost[0].total_bookings, 4);
  console.log('PASS: missing/blank email falls back to phone with formatting normalized');

  await db.exec('TRUNCATE acuity_appointments');
  await historical({name:'Shared Phone',email:'first@example.test',phone:'+65 81234567'});
  await historical({name:'Shared Phone',email:'second@example.test',phone:'+65 81234567'});
  lost = await analyse();
  assert.equal(lost.length,2);
  assert.notEqual(lost[0].customer_key,lost[1].customer_key);
  console.log('PASS: email takes priority even when two customers share a phone');

  await db.exec('TRUNCATE acuity_appointments');
  await historical({name:'No Contact'});
  await insert({name:'No Contact', canceled:true});
  lost = await analyse('1');
  assert.equal(rows[0].customers_analysed,4);
  assert.equal(lost.length,0);
  console.log('PASS: missing contact details never merge by name; canceled bookings remain excluded');
} finally {
  await db.close();
}
