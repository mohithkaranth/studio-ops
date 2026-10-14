import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const XLSX=require('xlsx');let workbook,pdfOptions;
const jsx=(type,props)=>({type,props});
const moduleObject={exports:{}};
const output=ts.transpileModule(fs.readFileSync('app/bank-statements/monthly/MonthlyTransactions.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
new Function('require','module','exports',output)(id=>{
  if(id==='react')return {useState:value=>[value,()=>{}],useMemo:callback=>callback()};
  if(id==='react/jsx-runtime')return {jsx,jsxs:jsx};
  if(id==='xlsx')return {...XLSX,writeFile:value=>{workbook=value}};
  if(id==='@/lib/studio-chat-pdf')return {createStudioChatPdf:async options=>{pdfOptions=options;return new Uint8Array([1])}};
  throw new Error(id);
},moduleObject,moduleObject.exports);
const data={month:'2026-09',account:{account_number:'TEST',currency:'SGD'},complete:true,coverageEnd:'2026-09-30',creditCents:10300,debitCents:0,netCents:10300,openingCents:0,closingCents:10300,warnings:[],rows:Array.from({length:103},(_,index)=>({id:String(index+1),transaction_date:'2026-09-01',value_date:'2026-09-01',description_1:`Credit ${index+1}`,description_2:'',credit:'1.00',debit:null,running_balance:String(index+1)}))};
const tree=moduleObject.exports.default({data});
const walk=node=>Array.isArray(node)?node.flatMap(walk):node&&typeof node==='object'?[node,...walk(node.props?.children)]:[];
const controls=walk(tree).filter(node=>node.type==='button');
await controls.find(node=>node.props.children==='Download Excel').props.onClick();
const parsed=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
const exported=XLSX.utils.sheet_to_json(parsed.Sheets.Transactions);
assert.equal(exported.length,103);assert.equal(exported.at(-1).Description,'Credit 103');assert.equal(exported.reduce((sum,row)=>sum+row.Credit,0),103);
const saved={fetch:globalThis.fetch,window:globalThis.window,document:globalThis.document,setTimeout:globalThis.setTimeout};
try {
  globalThis.fetch=async()=>new Response(new Uint8Array([1]));
  globalThis.window={location:{origin:'https://studio.example'}};
  globalThis.document={createElement:()=>({click(){}})};
  globalThis.setTimeout=callback=>{callback();return 0};
  await controls.find(node=>node.props.children==='Download PDF').props.onClick();
  assert.equal(pdfOptions.messages.length,3);
  assert.equal(pdfOptions.messages.slice(1).reduce((sum,message)=>sum+message.table.rows.length,0),103);
  assert.equal(pdfOptions.messages.at(-1).table.rows.at(-1).description,'Credit 103');
  assert.ok(pdfOptions.messages[0].content.includes('Transactions: 103'));
} finally {for(const [key,value] of Object.entries(saved))if(value===undefined)delete globalThis[key];else globalThis[key]=value;}
console.log('PASS: Excel and PDF exports preserve all 103 transactions and whole-month summary totals');
