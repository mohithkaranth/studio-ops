import {test} from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './ts-loader.mjs';
const {reportTableText,validReportTable}=loadTs('lib/studio-chat-table.ts');
const table={columns:[{key:'client',label:'Client name',format:'text'},{key:'count',label:'Bookings',format:'number'},{key:'cost',label:'Acuity cost',format:'money'}],rows:[{client:'A client',count:103,cost:126.69},{client:'Missing price',count:1,cost:null}]};
test('report history retains table facts, money and missing prices for follow-ups',()=>{
  assert.ok(validReportTable(table));
  const context=reportTableText(table);
  assert.ok(context.includes('A client | 103 | SGD 126.69'));
  assert.ok(context.includes('Missing price | 1 | Unavailable'));
  assert.ok(!validReportTable({...table,rows:[{client:'Client',count:1,cost:NaN}]}));
});
test('validated client and general reports finish without per-row investigation or model rewriting',async()=>{
  const fetchBefore=globalThis.fetch,keyBefore=process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY='test-only';
  try {
    for(const name of ['get_client_booking_report','query_studio_report']) {
      let modelCalls=0,toolCalls=0;
      globalThis.fetch=async()=>{modelCalls++;return Response.json({status:'completed',output:[{type:'function_call',name,call_id:'report',arguments:'{}'}]});};
      const {answerStudioQuestion}=loadTs('app/api/studio-chat/agent.ts',{'./studio-tools':{studioTools:[],runStudioTool:async()=>{toolCalls++;return {data:{report:{answer:'January to September 2026',table}},sources:[]};}}});
      const result=await answerStudioQuestion('yes get their revenue and show a table',[]);
      assert.equal(modelCalls,1);assert.equal(toolCalls,1);
      assert.deepEqual(result.table,table);assert.equal(result.answer,'January to September 2026');
    }
  } finally {globalThis.fetch=fetchBefore;if(keyBefore===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=keyBefore;}
});
