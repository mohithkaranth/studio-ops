import {test} from 'node:test';
import assert from 'node:assert/strict';
import {wrapPdfText,recordUrl} from '../lib/studio-chat-pdf.ts';
test('long references wrap within the printable width without dropping text',()=>{
  const measure={widthOfTextAtSize:(text,size)=>text.length*size};
  const text='Averylongbankreference1234567890';
  const lines=wrapPdfText(text,measure,1,8);
  assert.ok(lines.every(line=>line.length<=8));
  assert.equal(lines.join(''),text);
});
test('PDF evidence links retain the studio origin and reject external or script destinations',()=>{
  const origin='https://studio-ops-green.vercel.app';
  assert.equal(recordUrl('/bank-statements?uploadId=24#payment-2307',origin),origin+'/bank-statements?uploadId=24#payment-2307');
  for(const href of ['//external.example/data','https://external.example/data','javascript:alert(1)','/api/admin']) assert.equal(recordUrl(href,origin),null);
});
