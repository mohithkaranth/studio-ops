import type {ReportTable} from '@/lib/studio-chat-table';
export function recordReport(name:string,data:unknown) {
  if(!['find_bank_payments','find_bank_debits','find_acuity_bookings','get_bank_cash_movement'].includes(name)||!data||typeof data!=='object')return null;
  if(name==='get_bank_cash_movement') {
    const value=data as {reportText:string;creditCents:number;debitCents:number;netCents:number;creditCount:number;debitCount:number};
    const table:ReportTable={columns:[{key:'metric',label:'Bank movement',format:'text'},{key:'amount',label:'Amount',format:'money'},{key:'count',label:'Transactions',format:'text'}],rows:[
      {metric:'Credits',amount:value.creditCents/100,count:String(value.creditCount)},
      {metric:'Debits',amount:value.debitCents/100,count:String(value.debitCount)},
      {metric:'Net movement',amount:value.netCents/100,count:'Not applicable'},
    ]};
    return {answer:value.reportText,table};
  }
  const value=data as {count:number;totalCents:number;missingPrices?:number;records:Record<string,unknown>[]};
  if(!Array.isArray(value.records))return null;
  const bank=name!=='find_acuity_bookings',incoming=name==='find_bank_payments';
  const table:ReportTable=bank?{
    columns:[{key:'date',label:'Transaction date',format:'text'},{key:'description',label:'Description',format:'text'},{key:'amount',label:incoming?'Bank credit':'Bank debit',format:'money'},{key:'status',label:'Status',format:'text'}],
    rows:value.records.map(row=>({date:String(row.date),description:String(row.description),amount:Number(row.cents)/100,status:String(row.status)})),
  }:{
    columns:[{key:'client',label:'Client name',format:'text'},{key:'date',label:'Session date',format:'text'},{key:'type',label:'Booking type',format:'text'},{key:'cost',label:'Acuity cost',format:'money'}],
    rows:value.records.map(row=>({client:String(row.client),date:new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}).format(new Date(String(row.appointment_datetime))),type:String(row.appointment_type_name??'Unknown'),cost:row.price===null?null:Number(row.price)})),
  };
  return {answer:`Showing ${value.records.length} of ${value.count} matching ${bank?'bank transactions':'bookings'}. The total covers all matches, including records beyond the displayed rows.\n\n${value.missingPrices?`${value.missingPrices} bookings have no saved price; a complete cost total is unavailable.`:`Total ${bank?(incoming?'bank credits':'bank debits'):'Acuity cost'}: SGD ${(value.totalCents/100).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})}.`}\n\n${bank?'Raw bank movements include transfers. Credit exclusions apply only to reconciliation.':'Acuity cost is booking value, not confirmed bank receipts. Cancelled bookings excluded.'}`,table};
}
