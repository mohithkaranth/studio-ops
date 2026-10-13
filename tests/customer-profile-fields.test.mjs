import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerProfileFields} from '../lib/customer-profile-fields.ts';
test('reads saved notes and Acuity form values without exposing unrelated raw fields',()=>{
  const fields=customerProfileFields({notes:'Prefers the living room',privateToken:'do-not-expose',forms:[{name:'Booking questions',values:[{name:'Band',value:'Studio Band'},{name:'Needs equipment',value:false},{name:'Members',value:4},{name:'Blank',value:''}]}]});
  assert.equal(fields.notes,'Prefers the living room');
  assert.deepEqual(fields.formAnswers.map(item=>item.answer),['Studio Band','false','4']);
  assert.equal(fields.privateToken,undefined);
});
test('missing metadata stays unavailable and long answers are flagged as truncated',()=>{
  assert.deepEqual(customerProfileFields(null),{notes:null,formAnswers:[],truncated:false});
  const fields=customerProfileFields(JSON.stringify({notes:'x'.repeat(5000),forms:[{name:'Form',values:[{name:'Answer',value:'y'.repeat(3000)}]}]}));
  assert.equal(fields.notes.length,4000);
  assert.equal(fields.formAnswers[0].answer.length,2000);
  assert.equal(fields.truncated,true);
});
