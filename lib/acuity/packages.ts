import 'server-only';
import {sql} from '@/lib/db';
import type postgres from 'postgres';

type RecordData = Record<string, postgres.JSONValue> & {id: number};
const ORDER_LIMIT = 10000;

export async function ensurePackageTables() {
  await sql`create table if not exists acuity_package_products (id bigint primary key, raw_json jsonb not null, synced_at timestamptz not null)`;
  await sql`create table if not exists acuity_package_orders (id bigint primary key, raw_json jsonb not null, synced_at timestamptz not null)`;
  await sql`create table if not exists acuity_package_certificates (id bigint primary key, certificate_code text not null, order_id bigint, product_id bigint, raw_json jsonb not null, synced_at timestamptz not null)`;
  await sql`create index if not exists acuity_package_certificate_code_idx on acuity_package_certificates(certificate_code)`;
  await sql`create table if not exists acuity_package_syncs (id bigint generated always as identity primary key, synced_at timestamptz not null, products integer not null, orders integer not null, certificates integer not null)`;
}

async function fetchRecords(endpoint: string, auth: string): Promise<RecordData[]> {
  const response = await fetch(`https://acuityscheduling.com/api/v1/${endpoint}`, {headers:{Authorization:auth}, cache:'no-store', signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`Acuity package request failed (${response.status}).`);
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.some(row => !row || !Number.isSafeInteger(row.id) || row.id <= 0)) throw new Error('Acuity returned invalid package records. Nothing was imported.');
  if (new Set(data.map(row=>row.id)).size !== data.length) throw new Error('Acuity returned duplicate package IDs. Nothing was imported.');
  return data;
}

export async function syncAcuityPackages() {
  const user = process.env.ACUITY_USER_ID, key = process.env.ACUITY_API_KEY;
  if (!user || !key) throw new Error('Acuity credentials are not configured.');
  const syncedAt = new Date().toISOString();
  const auth = 'Basic '+Buffer.from(`${user}:${key}`).toString('base64');
  const [activeProducts, deletedProducts, orders, certificates] = await Promise.all([
    fetchRecords('products',auth), fetchRecords('products?deleted=true',auth), fetchRecords(`orders?max=${ORDER_LIMIT}`,auth), fetchRecords('certificates',auth),
  ]);
  const products = [...new Map([...deletedProducts,...activeProducts].map(row=>[row.id,row])).values()];
  if (orders.length >= ORDER_LIMIT) throw new Error('Acuity order history reached the import limit. Nothing was imported; a full-history export is needed.');
  if (certificates.some(row => typeof row.certificate !== 'string' || !row.certificate.trim())) throw new Error('Acuity returned a certificate without a code. Nothing was imported.');
  await ensurePackageTables();
  await sql.begin(async tx => {
    // Serialise overlapping refreshes so an older snapshot cannot overwrite a newer one.
    await tx`lock table acuity_package_syncs in exclusive mode`;
    const latest = await tx`select synced_at from acuity_package_syncs order by synced_at desc limit 1`;
    if (latest[0] && new Date(latest[0].synced_at).getTime() > new Date(syncedAt).getTime()) throw new Error('A newer package sync has already completed.');
    for (const row of products) await tx`insert into acuity_package_products values (${row.id}, ${tx.json(row)}, ${syncedAt}) on conflict(id) do update set raw_json=excluded.raw_json,synced_at=excluded.synced_at`;
    for (const row of orders) await tx`insert into acuity_package_orders values (${row.id}, ${tx.json(row)}, ${syncedAt}) on conflict(id) do update set raw_json=excluded.raw_json,synced_at=excluded.synced_at`;
    for (const row of certificates) await tx`insert into acuity_package_certificates values (${row.id}, ${String(row.certificate)}, ${typeof row.orderID==='number'?row.orderID:null}, ${typeof row.productID==='number'?row.productID:null}, ${tx.json(row)}, ${syncedAt}) on conflict(id) do update set certificate_code=excluded.certificate_code,order_id=excluded.order_id,product_id=excluded.product_id,raw_json=excluded.raw_json,synced_at=excluded.synced_at`;
    await tx`insert into acuity_package_syncs(synced_at,products,orders,certificates) values (${syncedAt},${products.length},${orders.length},${certificates.length})`;
  });
  return {syncedAt, products:products.length, orders:orders.length, certificates:certificates.length};
}

export async function getPackageSyncStatus() {
  await ensurePackageTables();
  const rows = await sql`select synced_at, products, orders, certificates from acuity_package_syncs order by synced_at desc limit 1`;
  return rows[0] ?? null;
}

export async function findAcuityPackages(search: string | null) {
  const status = await getPackageSyncStatus();
  if (!status) return {status:null, message:'Package data has not been synced yet.'};
  const text = search?.trim() ?? '';
  if (text.length > 200) throw new Error('Use a search of up to 200 characters.');
  const match = '%'+text.toLowerCase().replace(/[\\%_]/g,'\\$&')+'%';
  const orders = await sql`select o.id, o.raw_json, o.synced_at,
    coalesce((select jsonb_agg(c.raw_json) from acuity_package_certificates c where c.order_id=o.id), '[]'::jsonb) as certificates
    from acuity_package_orders o where
    lower(concat_ws(' ',o.raw_json->>'firstName',o.raw_json->>'lastName',o.raw_json->>'email',o.raw_json->>'phone',o.raw_json->>'title',o.id::text)) like ${match}
    or exists(select 1 from acuity_package_certificates c where c.order_id=o.id and lower(concat_ws(' ',c.certificate_code,c.raw_json->>'name',c.raw_json->>'email')) like ${match}) order by o.id desc`;
  const certificates = await sql`select c.id,c.raw_json,c.synced_at,
    (select count(*)::integer from acuity_appointments a where a.certificate_code=c.certificate_code and not coalesce(a.canceled,false)) as stored_booking_count,
    coalesce((select jsonb_agg(jsonb_build_object('id',a.acuity_appointment_id,'date',a.appointment_datetime,'type',a.appointment_type_name,'client',concat_ws(' ',a.client_first_name,a.client_last_name))) from acuity_appointments a where a.certificate_code=c.certificate_code and not coalesce(a.canceled,false)), '[]'::jsonb) as bookings
    from acuity_package_certificates c where lower(concat_ws(' ',c.certificate_code,c.raw_json->>'name',c.raw_json->>'email',c.order_id::text)) like ${match}
    or c.order_id=any(${sql.array(orders.map(row=>row.id))}::bigint[]) order by c.id desc`;
  const products = await sql`select raw_json from acuity_package_products where lower(concat_ws(' ',raw_json->>'name',raw_json->>'description')) like ${match} order by id`;
  let orderTotalCents = 0, paidOrderTotalCents = 0, unknownTotals = 0;
  for (const row of orders) {
    const total = row.raw_json.total;
    if (total === null || total === undefined || total === '' || !Number.isFinite(Number(total))) {unknownTotals++;continue;}
    const cents = Math.round(Number(total)*100); orderTotalCents += cents;
    if (row.raw_json.status === 'paid') paidOrderTotalCents += cents;
  }
  return {status, search:text||null, orderCount:orders.length, certificateCount:certificates.length, orderTotalCents, paidOrderTotalCents, unknownTotals,
    orders:orders.slice(0,100), certificates:certificates.slice(0,100), products:products.slice(0,100),
    notes:'Amounts and statuses are Acuity order records, not independently confirmed receipts. Acuity orders do not provide payment method or processor transaction references. Do not infer PayNow or card from paid status. Remaining balances and expiry are as of each certificate synced_at. Codes absent from the latest response are retained as historical records; do not assume their old balance is current. Booking usage covers stored appointments only; purchaser and booking customer may differ. Counts/totals cover all matches, with up to 100 rows per section. Order totals are in the Acuity account currency.'};
}

