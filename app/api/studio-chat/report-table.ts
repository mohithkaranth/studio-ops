import type {ReportTable} from '@/lib/studio-chat-table';
import {semanticModel} from './semantic-model';

const labels:Record<string,string>={client_name:'Client name',calendar_name:'Room',appointment_type_name:'Booking type',booking_count:'Number of bookings',booking_value:'Acuity cost',acuity_booking_count:'Number of bookings',acuity_booking_value:'Acuity cost',bank_transaction_count:'Number of transactions',transaction_date:'Transaction date',value_date:'Value date',appointment_datetime:'Session date',created_datetime:'Booked on',price:'Acuity cost',client_email:'Email',description_1:'Description',description_2:'Reference',counterparty_name:'Payer / recipient',reference_text:'Reference',running_balance:'Bank balance',credit:'Bank credit',debit:'Bank debit',amount:'Amount',paid_status:'Acuity paid status',canceled:'Cancelled'};
const monetary=new Set(['booking_value','acuity_booking_value','price','credit','debit','amount','running_balance',...Object.keys(semanticModel.bank.metrics).filter(key=>key!=='transaction_count'),...Object.keys(semanticModel.acuity.metrics).filter(key=>/price/.test(key))]);
export function studioReportTable(columns:string[],rows:Record<string,unknown>[]):ReportTable {
  return {
    columns:columns.map(key=>({key,label:labels[key]??semanticModel.bank.metrics[key]?.label??semanticModel.acuity.metrics[key]?.label??semanticModel.bank.dimensions[key]?.label??semanticModel.acuity.dimensions[key]?.label??key.replace(/_/g,' ').replace(/^./,letter=>letter.toUpperCase()),format:monetary.has(key)?'money':/count$/.test(key)?'number':'text'})),
    rows:rows.map(row=>Object.fromEntries(columns.map(key=>{
      const value=row[key];
      const dateValue=value instanceof Date?value:new Date(String(value));
      const formatted=/^(appointment_datetime|created_datetime)$/.test(key)&&value&&!Number.isNaN(dateValue.getTime())
        ?new Intl.DateTimeFormat('en-SG',{timeZone:'Asia/Singapore',dateStyle:'medium',timeStyle:'short'}).format(dateValue)
        :/_date$/.test(key)&&value instanceof Date?value.toISOString().slice(0,10):value;
      return [key,value===null||value===undefined?null:monetary.has(key)||/count$/.test(key)?Number(value):String(formatted)];
    }))),
  };
}
