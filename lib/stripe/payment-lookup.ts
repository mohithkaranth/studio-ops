import 'server-only';

type Data = Record<string, unknown>;
const object = (value: unknown): Data | null => value && typeof value==='object' && !Array.isArray(value) ? value as Data : null;
const text = (value: unknown) => typeof value==='string' ? value.slice(0,500) : null;
const amount = (value: unknown) => Number.isSafeInteger(value) && Number(value)>=0 ? Number(value) : null;
const date = (value: unknown) => typeof value==='number' && Number.isFinite(value) ? new Date(value*1000).toISOString() : null;

export function stripePaymentReference(input: string): string {
  const value=input.trim();
  if (/^(pi|ch|py)_[A-Za-z0-9]{1,150}$/.test(value)) return value;
  try {
    const url=new URL(value);
    if(url.protocol==='https:' && url.hostname==='dashboard.stripe.com' && !url.username && !url.password) {
      const match=url.pathname.match(/\/payments\/((?:pi|ch|py)_[A-Za-z0-9]{1,150})\/?$/);
      if(match)return match[1];
    }
  } catch {}
  throw new Error('Use a Stripe payment ID beginning pi_, ch_ or py_, or its Stripe dashboard link.');
}

export function stripeReferencesInQuestion(question: string): string[] {
  return [...new Set(question.match(/\b(?:pi|ch|py)_[A-Za-z0-9]{1,150}\b/g)??[])];
}

async function request(path: string, key: string) {
  let response: Response;
  try {response=await fetch('https://api.stripe.com/v1/'+path,{method:'GET',headers:{Authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(15000)});}
  catch {throw new Error('Stripe lookup timed out or could not connect. Please try again.');}
  const data=object(await response.json().catch(()=>null));
  if(response.status===404 && object(data?.error)?.code==='resource_missing')return null;
  if(response.status===401||response.status===403)throw new Error('The Studio Ops Stripe connection cannot read this payment. Check its Stripe key permissions.');
  if(!response.ok||!data)throw new Error(`Stripe could not finish the payment lookup (HTTP ${response.status}). Please try again.`);
  return data;
}

export async function lookupStripePayment(input: string) {
  const reference=stripePaymentReference(input);
  const key=process.env.STRIPE_SECRET_KEY?.trim();
  if(!key)throw new Error('The Studio Ops Stripe connection is not configured.');
  const intent=reference.startsWith('pi_');
  const data=await request(intent?`payment_intents/${reference}?expand[]=latest_charge`:`charges/${reference}`,key);
  if(!data)return {found:false,reference,reportText:`Stripe could not find ${reference} in the connected account and mode. This does not establish that the payment does not exist in another Stripe account or mode.`,dashboardUrl:null};
  if(data.object!==(intent?'payment_intent':'charge')||data.id!==reference)throw new Error('Stripe returned an unexpected payment record.');
  let charge=intent?object(data.latest_charge):data;
  if(intent&&typeof data.latest_charge==='string'&&/^(ch|py)_[A-Za-z0-9]+$/.test(data.latest_charge))charge=await request('charges/'+data.latest_charge,key);
  if(charge&&charge.object!=='charge')throw new Error('Stripe returned an unexpected charge record.');
  const details=object(charge?.payment_method_details), card=object(details?.card), billing=object(charge?.billing_details);
  const refunded=amount(charge?.amount_refunded), captured=amount(charge?.amount_captured);
  const metadata=object(data.metadata);
  const links=Object.fromEntries(Object.entries(metadata??{}).filter(([field,value])=>/^(acuity[_-]?)?(appointment|order)([_-]?id)?$/i.test(field)&&typeof value==='string').map(([field,value])=>[field,text(value)]));
  const payment={found:true,reference,paymentIntentId:intent?reference:text(charge?.payment_intent),chargeId:text(charge?.id),
    liveMode:typeof data.livemode==='boolean'?data.livemode:null,status:text(data.status),currency:text(data.currency)?.toUpperCase()??null,
    amountMinor:amount(data.amount),receivedMinor:intent?amount(data.amount_received):captured,capturedMinor:captured,refundedMinor:refunded,
    netCapturedMinor:captured!==null&&refunded!==null?captured-refunded:null,
    createdAt:date(data.created),chargeCreatedAt:date(charge?.created),paid:typeof charge?.paid==='boolean'?charge.paid:null,captured:typeof charge?.captured==='boolean'?charge.captured:null,
    disputed:typeof charge?.disputed==='boolean'?charge.disputed:null,paymentMethod:text(details?.type),cardBrand:text(card?.brand),cardLast4:text(card?.last4),
    customerName:text(billing?.name),customerEmail:text(billing?.email)??text(data.receipt_email),description:text(data.description)??text(charge?.description),acuityReferences:links,
    dashboardUrl:`https://dashboard.stripe.com/${data.livemode===false?'test/':''}payments/${reference}`};
  function money(value:number|null) {
    if(value===null||!payment.currency)return 'Unavailable';
    // Stripe amounts use the currency's minor unit (SGD cents); never assume all currencies use cents.
    try {const formatter=new Intl.NumberFormat('en-SG',{style:'currency',currency:payment.currency,currencyDisplay:'code'});const digits=formatter.resolvedOptions().maximumFractionDigits??2;return formatter.format(value/10**digits);}
    catch {return `${value} minor units (${payment.currency})`;}
  }
  const lines=[`Stripe payment ${reference}`,`Status: ${payment.status??'Unavailable'}${payment.liveMode===false?' (test mode)':''}.`,`Amount: ${money(payment.amountMinor)}.`,`Received: ${money(payment.receivedMinor)}.`,
    payment.createdAt?`Created: ${new Date(payment.createdAt).toLocaleString('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'})} (Singapore time).`:null,
    `Payment method: ${payment.paymentMethod??'Unavailable'}${payment.cardBrand?' · '+payment.cardBrand:''}${payment.cardLast4?' ending '+payment.cardLast4:''}.`,
    payment.customerName?`Customer: ${payment.customerName}${payment.customerEmail?' · '+payment.customerEmail:''}.`:payment.customerEmail?`Customer email: ${payment.customerEmail}.`:null,
    payment.description?`Description: ${payment.description}`:null,
    refunded!==null?`Refunded: ${money(refunded)}. Remaining captured amount: ${money(payment.netCapturedMinor)}.`:null,
    payment.disputed?'This charge is disputed.':null,
    charge&&payment.captured===false?'The charge has not been captured.':null,
    Object.keys(links).length?`Acuity references recorded by Stripe: ${Object.entries(links).map(([k,v])=>`${k}: ${v}`).join(', ')}.`:null,
    'Checked directly in Stripe. This does not establish a bank payout or a booking/package allocation.'];
  return {...payment,reportText:lines.filter(Boolean).join('\n')};
}
